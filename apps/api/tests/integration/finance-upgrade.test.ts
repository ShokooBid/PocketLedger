import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import pg from "pg";
import { expect, it } from "vitest";
import { disposableDatabase } from "../support/disposable.js";
import {
  backfillFinanceOwner,
  verifyFinanceMigration,
  prepareFinanceUpgrade
} from "../../src/finance/migration.js";
import { createTransactionService } from "../../src/transactions/service.js";
import { createAccountService } from "../../src/accounts/service.js";
import { createDashboardService } from "../../src/dashboard/service.js";

it("rehearses expansion, drain, resumable mixed-currency upgrade and final constraints without changing historical data", async () => {
  const database = disposableDatabase({ migrate: false }),
    db = database.db;
  const sql = new pg.Client({ connectionString: database.url });
  let connected = false;
  try {
    await database.start();
    await sql.connect();
    connected = true;
    const root = new URL("../../prisma/migrations/", import.meta.url),
      target = "20261103000000_transaction_accounts";
    for (const name of (await readdir(root))
      .filter((name) => /^\d/.test(name) && name < target)
      .sort())
      await sql.query(
        await readFile(new URL(`${name}/migration.sql`, root), "utf8")
      );
    const mixed = randomUUID(),
      single = randomUUID();
    for (const userId of [mixed, single]) {
      const categoryId = randomUUID(),
        importId = randomUUID();
      await sql.query('INSERT INTO "User" (id, email) VALUES ($1, $2)', [
        userId,
        `${userId}@example.invalid`
      ]);
      await sql.query(
        'INSERT INTO "Category" (id, "userId", name) VALUES ($1, $2, $3)',
        [categoryId, userId, "Historical food"]
      );
      await sql.query(
        'INSERT INTO "Import" (id, "userId", status) VALUES ($1, $2, $3)',
        [importId, userId, "confirmed"]
      );
      for (const currency of userId === mixed ? ["CAD", "USD"] : ["USD"])
        for (const direction of ["income", "expense"])
          await sql.query(
            `INSERT INTO "Transaction" ("userId", "categoryId", "importId", direction, "amountMinor", currency, date, merchant, note, "createdAt", "updatedAt")
            VALUES ($1, $2, $3, $4, $5, $6, '2020-02-29', 'Preserve merchant', 'Preserve note', '2020-03-01T12:00:00Z', '2020-03-02T12:00:00Z')`,
            [
              userId,
              categoryId,
              importId,
              direction,
              direction === "income" ? 10000 : 1250,
              currency
            ]
          );
      await sql.query(
        'UPDATE "Category" SET "archivedAt" = CURRENT_TIMESTAMP WHERE id = $1',
        [categoryId]
      );
    }
    // Existing explicit denomination must survive, including a non-CAD ledger.
    await sql.query(
      'INSERT INTO "FinancePreferences" ("userId", "entryCurrency") VALUES ($1, $2)',
      [single, "USD"]
    );
    const before = (await sql.query('SELECT * FROM "Transaction" ORDER BY id'))
      .rows;
    const totalsSql = `SELECT "userId", currency, direction, count(*)::text, sum("amountMinor")::text AS total
      FROM "Transaction" GROUP BY "userId", currency, direction ORDER BY "userId", currency, direction`;
    const totalsBefore = (await sql.query(totalsSql)).rows;
    await sql.query(
      await readFile(new URL(`${target}/migration.sql`, root), "utf8")
    );
    expect(
      (await sql.query('SELECT * FROM "Transaction" ORDER BY id')).rows
    ).toEqual(before.map((row) => ({ ...row, accountId: null })));
    expect(await db.account.count()).toBe(0);

    // Final deployment must refuse an existing ledger before assignment/locking.
    await expect(
      sql.query(
        await readFile(
          new URL("20261104000000_canonical_finance/migration.sql", root),
          "utf8"
        )
      )
    ).rejects.toThrow("Complete the finance account backfill");
    await sql.query("ROLLBACK");

    expect(
      (await backfillFinanceOwner(db, mixed, { apply: false })).conflicts
    ).toContain("EXPLICIT_CURRENCY_CHOICE_REQUIRED");
    expect(await db.account.count()).toBe(0);

    // Prove the exclusive transition cannot pass a live legacy shared lock.
    let release!: () => void, entered!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const held = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT phase FROM "FinanceRollout" WHERE id = 1 FOR SHARE`;
      entered();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    await ready;
    try {
      await sql.query("BEGIN");
      await sql.query("SET LOCAL lock_timeout = '50ms'");
      await expect(
        sql.query(
          `UPDATE "FinanceRollout" SET phase = 'upgrading' WHERE id = 1`
        )
      ).rejects.toMatchObject({ code: "55P03" });
    } finally {
      await sql.query("ROLLBACK");
      release();
      await held;
    }
    expect(await prepareFinanceUpgrade(db)).toBe("upgrading");
    expect(await prepareFinanceUpgrade(db)).toBe("upgrading");

    await expect(verifyFinanceMigration(db)).rejects.toMatchObject({
      code: "MIGRATION_VERIFICATION_FAILED"
    });
    expect(
      (await backfillFinanceOwner(db, mixed, { apply: true })).conflicts
    ).toContain("EXPLICIT_CURRENCY_CHOICE_REQUIRED");

    const accounts = createAccountService(db);
    const collision = await accounts.create(single, {
      name: "Unassigned (USD)",
      currency: "USD",
      type: "bank",
      openingDate: "2020-01-01",
      openingBalanceMinor: 0
    });
    expect(
      (await backfillFinanceOwner(db, single, { apply: true })).conflicts
    ).toContain("UNASSIGNED_NAME_CONFLICT");
    await accounts.update(single, collision.id, {
      name: "My own named account"
    });
    expect(
      (
        await backfillFinanceOwner(db, single, {
          apply: true,
          entryCurrency: "CAD"
        })
      ).conflicts
    ).toContain("EXPLICIT_PREFERENCE_MUST_BE_PRESERVED");
    expect(
      (await backfillFinanceOwner(db, single, { apply: true })).conflicts
    ).toEqual([]);
    const result = await backfillFinanceOwner(db, mixed, {
      apply: true,
      entryCurrency: "CAD"
    });
    expect(result.conflicts).toEqual([]);
    expect(result.assignments).toHaveLength(2);
    const assigned = await db.account.findMany({ where: { userId: mixed } });
    expect(assigned.map((a) => a.name).sort()).toEqual([
      "Unassigned (CAD)",
      "Unassigned (USD)"
    ]);
    expect(
      assigned.every(
        (a) =>
          a.openingBalanceMinor === 0 &&
          a.openingDate.toISOString().slice(0, 10) === "2020-02-29"
      )
    ).toBe(true);
    expect(
      (await backfillFinanceOwner(db, mixed, { apply: true })).assignments
    ).toEqual([]);
    expect(
      (await db.account.findMany({ where: { userId: mixed } }))
        .map((a) => a.id)
        .sort()
    ).toEqual(assigned.map((a) => a.id).sort());
    const after = (await sql.query('SELECT * FROM "Transaction" ORDER BY id'))
      .rows;
    expect(
      after.map((row) => {
        const copy = { ...row };
        delete copy.accountId;
        return copy;
      })
    ).toEqual(before);
    expect((await sql.query(totalsSql)).rows).toEqual(totalsBefore);
    expect(
      (
        await db.financePreferences.findUniqueOrThrow({
          where: { userId: single }
        })
      ).entryCurrency
    ).toBe("USD");
    expect(
      (
        await db.financePreferences.findUniqueOrThrow({
          where: { userId: mixed }
        })
      ).currencyLockedAt
    ).not.toBeNull();
    expect(await verifyFinanceMigration(db)).toBe("verified");
    await sql.query(
      await readFile(
        new URL("20261104000000_canonical_finance/migration.sql", root),
        "utf8"
      )
    );
    expect(
      (await sql.query(`SELECT to_regclass('"FinanceRollout"') AS gate`))
        .rows[0].gate
    ).toBeNull();
    for (const account of assigned)
      expect(
        (await accounts.get(mixed, account.id, "2020-02-29")).balanceMinor
      ).toBe(8750);
    for (const currency of ["CAD", "USD"] as const) {
      expect(
        await createDashboardService(db).summary(mixed, {
          from: "2020-02-29",
          to: "2020-02-29",
          currency,
          recentLimit: 5
        })
      ).toMatchObject({
        incomeMinor: 10000,
        expensesMinor: 1250,
        netMinor: 8750
      });
    }
    const row = await createTransactionService(db).get(
      mixed,
      before.find((r) => r.userId === mixed).id
    );
    expect(row.importId).not.toBeNull();
    expect(row).not.toHaveProperty("merchant");
    expect(
      (await db.transaction.findUniqueOrThrow({ where: { id: row.id } }))
        .merchant
    ).toBe("Preserve merchant");
    const [required] = (
      await sql.query(
        `SELECT attnotnull FROM pg_attribute WHERE attrelid = '"Transaction"'::regclass AND attname = 'accountId'`
      )
    ).rows;
    expect(required.attnotnull).toBe(true);
  } finally {
    try {
      if (connected) await sql.end();
    } finally {
      await database.close();
    }
  }
});
