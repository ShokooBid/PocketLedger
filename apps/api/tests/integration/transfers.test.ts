import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { createAuthService } from "../../src/auth/service.js";
import { createAccountService } from "../../src/accounts/service.js";
import { createPreferencesService } from "../../src/preferences/service.js";
import { createTransactionService } from "../../src/transactions/service.js";
import { createDashboardService } from "../../src/dashboard/service.js";
import { createTransferService } from "../../src/transfers/service.js";
import {
  transferSchema,
  type TransferCreate
} from "../../src/transfers/contracts.js";
import { testConfig } from "../fixtures.js";
import { disposableDatabase } from "../support/disposable.js";

// This suite migrates ONLY the helper's random disposable schema when you run it.
const database = disposableDatabase(),
  db = database.db;
const accounts = createAccountService(db),
  preferences = createPreferencesService(db),
  transfers = createTransferService(db);
let app: Awaited<ReturnType<typeof buildApp>>;
type Owner = {
  id: string;
  token: string;
  from: string;
  to: string;
  categoryId: string;
};
const base = "/v1/transfers";
beforeAll(async () => {
  await database.start();
  const config = testConfig(),
    auth = await createAuthService(db, config, async () => {
      throw new Error("No provider calls.");
    });
  app = await buildApp(config, auth, {
    logger: false,
    rateLimitMax: 10000,
    accounts,
    preferences,
    transfers,
    transactions: createTransactionService(db),
    dashboard: createDashboardService(db)
  });
});
afterAll(async () => {
  try {
    await app?.close();
  } finally {
    await database.close();
  }
});
async function owner(): Promise<Owner> {
  const email = `${randomUUID()}@example.invalid`,
    result = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { email, password: "synthetic transfer passphrase" }
    });
  expect(result.statusCode, result.body).toBe(201);
  const { id } = await db.user.findUniqueOrThrow({ where: { email } });
  await preferences.update(id, { entryCurrency: "CAD" });
  const account = {
    type: "bank" as const,
    currency: "CAD" as const,
    openingDate: "2026-01-01",
    openingBalanceMinor: 10000
  };
  const from = await accounts.create(id, { ...account, name: "Source" }),
    to = await accounts.create(id, {
      ...account,
      name: "Destination",
      openingBalanceMinor: 0
    });
  const category = await db.category.findFirstOrThrow({
    where: { userId: null, parentId: { not: null } }
  });
  return {
    id,
    token: result.json().accessToken,
    from: from.id,
    to: to.id,
    categoryId: category.id
  };
}
function input(
  user: Owner,
  extra: Partial<TransferCreate> = {}
): TransferCreate {
  return {
    fromAccountId: user.from,
    toAccountId: user.to,
    amountMinor: 2500,
    date: "2026-02-01",
    note: "Move savings",
    clientRequestId: randomUUID(),
    ...extra
  };
}
function request(
  user: Owner,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  url = base,
  payload?: object
) {
  return app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${user.token}` },
    ...(payload ? { payload } : {})
  });
}
async function create(user: Owner, payload = input(user)) {
  const result = await request(user, "POST", base, payload);
  expect(result.statusCode, result.body).toBe(201);
  return transferSchema.parse(result.json());
}
async function pair(id: string) {
  return db.transaction.findMany({
    where: { transferId: id },
    orderBy: { direction: "asc" }
  });
}
describe("atomic owned same-currency transfers", () => {
  it("authenticates every route before validation and rejects category/leg creation through normal routes", async () => {
    for (const [method, url, payload] of [
      ["GET", base, undefined],
      ["POST", base, {}],
      ["GET", `${base}/${randomUUID()}`, undefined],
      ["PATCH", `${base}/${randomUUID()}`, {}],
      ["DELETE", `${base}/${randomUUID()}`, undefined]
    ] as const)
      expect(
        (await app.inject({ method, url, ...(payload ? { payload } : {}) }))
          .statusCode
      ).toBe(401);
    const user = await owner();
    expect(
      (
        await request(user, "POST", base, {
          ...input(user),
          categoryId: user.categoryId
        })
      ).statusCode
    ).toBe(422);
    expect(
      (
        await request(user, "POST", "/v1/transactions", {
          accountId: user.from,
          direction: "expense",
          amountMinor: 2500,
          date: "2026-02-01",
          clientRequestId: randomUUID(),
          transferId: randomUUID()
        })
      ).statusCode
    ).toBe(422);
  });
  it("moves 25 CAD between balances while normal and shared/private category summaries stay unchanged", async () => {
    const user = await owner();
    const privateCategory = await db.category.create({
      data: { userId: user.id, name: "Personal" }
    });
    const normal = createTransactionService(db);
    for (const [direction, amountMinor, categoryId] of [
      ["income", 500, user.categoryId],
      ["expense", 200, privateCategory.id]
    ] as const)
      await normal.create(user.id, {
        accountId: user.from,
        categoryId,
        direction,
        amountMinor,
        date: "2026-02-01",
        note: null,
        clientRequestId: randomUUID()
      });
    const summary = createDashboardService(db),
      query = {
        from: "2026-02-01",
        to: "2026-02-28",
        currency: "CAD" as const,
        recentLimit: 5
      };
    const before = await summary.summary(user.id, query),
      row = await create(user);
    expect(row.currency).toBe("CAD");
    const postings = await pair(row.id);
    expect(postings).toHaveLength(2);
    expect(
      postings
        .map((posting) => [
          posting.direction,
          posting.accountId,
          posting.amountMinor,
          posting.categoryId,
          posting.clientRequestId,
          posting.creationFingerprint
        ])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
    ).toEqual(
      [
        ["income", user.to, 2500, null, null, null],
        ["expense", user.from, 2500, null, null, null]
      ].sort((a, b) => String(a[0]).localeCompare(String(b[0])))
    );
    expect(await accounts.get(user.id, user.from, "2026-02-01")).toMatchObject({
      balanceMinor: 7800
    });
    expect(await accounts.get(user.id, user.to, "2026-02-01")).toMatchObject({
      balanceMinor: 2500
    });
    expect(await accounts.get(user.id, user.to, "2026-01-31")).toMatchObject({
      balanceMinor: 0
    });
    expect(await summary.summary(user.id, query)).toEqual(before);
    expect(before).toMatchObject({
      incomeMinor: 500,
      expensesMinor: 200,
      netMinor: 300
    });
    expect(
      (await request(user, "GET", "/v1/transactions")).json().items
    ).toHaveLength(2);
    for (const leg of postings) {
      for (const method of ["GET", "PATCH", "DELETE"] as const)
        expect(
          (
            await request(
              user,
              method,
              `/v1/transactions/${leg.id}`,
              method === "PATCH" ? { amountMinor: 1 } : undefined
            )
          ).statusCode
        ).toBe(404);
    }
  });
  it("scopes all reads/writes and filters to the owner and rejects invalid account assignments", async () => {
    const user = await owner(),
      other = await owner(),
      row = await create(user);
    for (const method of ["GET", "PATCH", "DELETE"] as const)
      expect(
        (
          await request(
            other,
            method,
            `${base}/${row.id}`,
            method === "PATCH" ? { amountMinor: 1 } : undefined
          )
        ).statusCode
      ).toBe(404);
    expect((await request(other, "GET")).json().items).toEqual([]);
    expect(
      (await request(other, "GET", `${base}?accountId=${user.from}`)).statusCode
    ).toBe(404);
    for (const [patch, status] of [
      [{ toAccountId: user.from }, 422],
      [{ toAccountId: other.to }, 404],
      [{ date: "2025-12-31" }, 422]
    ] as const)
      expect(
        (await request(user, "PATCH", `${base}/${row.id}`, patch)).statusCode
      ).toBe(status);
    expect(
      (await request(user, "GET", `${base}?accountId=${user.to}&limit=1`))
        .json()
        .items.map((item: { id: string }) => item.id)
    ).toEqual([row.id]);
    const newer = await create(user, input(user, { date: "2026-02-02" }));
    const first = (await request(user, "GET", `${base}?limit=1`)).json();
    expect(first.items[0].id).toBe(newer.id);
    expect(
      (
        await request(user, "GET", `${base}?limit=1&after=${first.nextCursor}`)
      ).json().items[0].id
    ).toBe(row.id);
    expect(
      (
        await request(user, "GET", `${base}?from=2026-02-02&to=2026-02-02`)
      ).json().items
    ).toHaveLength(1);
  });
  it("serializes equal keys, preserves original creation intent through edits/archive, and releases it on hard delete", async () => {
    const user = await owner(),
      payload = input(user);
    const results = await Promise.all([
      request(user, "POST", base, payload),
      request(user, "POST", base, payload)
    ]);
    expect(results.map((result) => result.statusCode).sort()).toEqual([
      200, 201
    ]);
    const other = await owner();
    await create(
      other,
      input(other, { clientRequestId: payload.clientRequestId })
    );
    const row = transferSchema.parse(results[0].json()),
      original = await db.transfer.findUniqueOrThrow({ where: { id: row.id } });
    const oldLegIds = (await pair(row.id)).map((leg) => leg.id).sort();
    const changed = await request(user, "PATCH", `${base}/${row.id}`, {
      amountMinor: 3000,
      date: "2026-02-02",
      note: "Updated",
      fromAccountId: user.to,
      toAccountId: user.from
    });
    expect(changed.statusCode, changed.body).toBe(200);
    expect((await pair(row.id)).map((leg) => leg.id).sort()).toEqual(oldLegIds);
    expect(
      (await pair(row.id)).every(
        (leg) =>
          leg.amountMinor === 3000 &&
          leg.date.toISOString().slice(0, 10) === "2026-02-02" &&
          leg.note === "Updated"
      )
    ).toBe(true);
    expect(
      (await db.transfer.findUniqueOrThrow({ where: { id: row.id } }))
        .creationFingerprint
    ).toBe(original.creationFingerprint);
    expect(await accounts.get(user.id, user.from, "2026-02-02")).toMatchObject({
      balanceMinor: 13000
    });
    const replay = await request(user, "POST", base, payload);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(changed.json());
    expect(
      (await request(user, "POST", base, { ...payload, amountMinor: 3000 }))
        .statusCode
    ).toBe(409);
    const [conflict, same] = await Promise.all([
      request(user, "POST", base, { ...payload, note: "Different" }),
      request(user, "POST", base, payload)
    ]);
    expect(conflict.statusCode).toBe(409);
    expect(same.statusCode).toBe(200);
    await accounts.archive(user.id, user.to);
    expect((await request(user, "POST", base, payload)).statusCode).toBe(200);
    expect(
      (await request(user, "PATCH", `${base}/${row.id}`, { note: "Archived" }))
        .statusCode
    ).toBe(422);
    expect(
      (await request(user, "DELETE", `${base}/${row.id}`)).statusCode
    ).toBe(200);
    expect(await pair(row.id)).toEqual([]);
    expect(
      await db.transfer.count({
        where: { userId: user.id, clientRequestId: payload.clientRequestId }
      })
    ).toBe(0);
    expect((await request(user, "POST", base, payload)).statusCode).toBe(422); // New creation must revalidate archived accounts.
    const active = await accounts.create(user.id, {
      name: "Replacement",
      type: "cash",
      currency: "CAD",
      openingBalanceMinor: 0,
      openingDate: "2026-01-01"
    });
    const recreated = await create(user, {
      ...payload,
      toAccountId: active.id
    });
    expect(recreated.id).not.toBe(row.id);
    await transfers.remove(user.id, recreated.id);
    expect(
      (await create(user, { ...payload, toAccountId: active.id })).id
    ).not.toBe(recreated.id);
  });
  it("rejects incomplete, extra, malformed or independently changed legs at database commit", async () => {
    const user = await owner(),
      other = await owner();
    for (const mode of [
      "missing",
      "duplicate",
      "amount",
      "date",
      "note",
      "owner",
      "category",
      "identity",
      "account"
    ] as const) {
      const id = randomUUID();
      await expect(
        db.$transaction(async (tx) => {
          await tx.transfer.create({
            data: {
              id,
              userId: user.id,
              fromAccountId: user.from,
              toAccountId: user.to,
              amountMinor: 2500,
              date: new Date("2026-02-01"),
              clientRequestId: randomUUID(),
              creationFingerprint: "a".repeat(64)
            }
          });
          await tx.transaction.create({
            data: {
              userId: user.id,
              accountId: user.from,
              transferId: id,
              categoryId: null,
              direction: "expense",
              amountMinor: 2500,
              date: new Date("2026-02-01")
            }
          });
          if (mode === "missing") return;
          await tx.transaction.create({
            data: {
              userId: mode === "owner" ? other.id : user.id,
              accountId:
                mode === "owner"
                  ? other.to
                  : mode === "account"
                    ? user.from
                    : user.to,
              transferId: id,
              categoryId: mode === "category" ? user.categoryId : null,
              clientRequestId: mode === "identity" ? randomUUID() : null,
              creationFingerprint: mode === "identity" ? "b".repeat(64) : null,
              direction: mode === "duplicate" ? "expense" : "income",
              amountMinor: mode === "amount" ? 1 : 2500,
              date: new Date(mode === "date" ? "2026-02-02" : "2026-02-01"),
              note: mode === "note" ? "Mismatched" : null
            }
          });
        })
      ).rejects.toThrow();
      expect(await db.transfer.findUnique({ where: { id } })).toBeNull();
      expect(await pair(id)).toEqual([]);
    }
    const row = await create(user),
      legs = await pair(row.id),
      leg = legs[0]!;
    for (const sql of [
      () =>
        db.$executeRaw`DELETE FROM "Transaction" WHERE id = ${leg.id}::uuid`,
      () =>
        db.$executeRaw`UPDATE "Transaction" SET "amountMinor" = 1 WHERE id = ${leg.id}::uuid`,
      () =>
        db.$executeRaw`UPDATE "Transaction" SET date = DATE '2026-02-02' WHERE id = ${leg.id}::uuid`,
      () =>
        db.$executeRaw`UPDATE "Transaction" SET "transferId" = NULL, "categoryId" = ${user.categoryId}::uuid WHERE id = ${leg.id}::uuid`,
      () =>
        db.$executeRaw`UPDATE "Transfer" SET "amountMinor" = 1 WHERE id = ${row.id}::uuid`,
      () =>
        db.$executeRaw`UPDATE "Transfer" SET "creationFingerprint" = ${"b".repeat(64)} WHERE id = ${row.id}::uuid`,
      () =>
        db.$executeRaw`UPDATE "Transfer" SET "clientRequestId" = ${randomUUID()}::uuid WHERE id = ${row.id}::uuid`
    ])
      await expect(sql()).rejects.toThrow();
    expect(await pair(row.id)).toEqual(legs);
    await expect(
      db.transaction.create({
        data: {
          userId: user.id,
          accountId: user.from,
          categoryId: null,
          direction: "income",
          amountMinor: 1,
          date: new Date("2026-02-01")
        }
      })
    ).rejects.toThrow();
  });
  it("rejects historical owned accounts with mismatched immutable currencies through API and SQL", async () => {
    const user = await owner();
    // Same fixture technique as transaction reassignment tests: historical data
    // exists only in this disposable schema. Restore the guard before assertions.
    const usd = await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        'ALTER TABLE "Account" DISABLE TRIGGER "Account_rules"'
      );
      const row = await tx.account.create({
        data: {
          userId: user.id,
          name: "Historical USD",
          type: "cash",
          currency: "USD",
          openingDate: new Date("2026-01-01"),
          openingBalanceMinor: 0
        }
      });
      await tx.$executeRawUnsafe(
        'ALTER TABLE "Account" ENABLE TRIGGER "Account_rules"'
      );
      return row;
    });
    const payload = input(user, { toAccountId: usd.id });
    const rejected = await request(user, "POST", base, payload);
    expect(rejected.statusCode).toBe(422);
    expect(rejected.json().error.code).toBe("CURRENCY_MISMATCH");
    await expect(
      db.transfer.create({
        data: {
          ...payload,
          date: new Date(payload.date),
          userId: user.id,
          creationFingerprint: "a".repeat(64)
        }
      })
    ).rejects.toThrow();
    const row = await create(user);
    expect(
      (
        await request(user, "PATCH", `${base}/${row.id}`, {
          toAccountId: usd.id
        })
      ).statusCode
    ).toBe(422);
    await expect(
      db.transfer.update({
        where: { id: row.id },
        data: { toAccountId: usd.id }
      })
    ).rejects.toThrow();
    expect((await transfers.get(user.id, row.id)).toAccountId).toBe(user.to);
  });
  it("rolls back aggregate creation, editing and deletion if a leg write fails", async () => {
    const user = await owner(),
      payload = input(user, { amountMinor: 1234567 });
    const existing = await create(user),
      originalLegs = await pair(existing.id);
    await db.$executeRawUnsafe(`CREATE FUNCTION fail_transfer_credit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF TG_OP = 'DELETE' THEN
        IF OLD."transferId" IS NOT NULL AND OLD.direction = 'income' THEN RAISE EXCEPTION 'Synthetic leg deletion failure'; END IF;
        RETURN OLD;
      END IF;
      IF NEW."transferId" IS NOT NULL AND NEW.direction = 'income' AND NEW."amountMinor" = 1234567 THEN RAISE EXCEPTION 'Synthetic second leg failure'; END IF;
      RETURN NEW; END; $$`);
    await db.$executeRawUnsafe(
      `CREATE TRIGGER test_fail_credit BEFORE INSERT OR UPDATE OR DELETE ON "Transaction" FOR EACH ROW EXECUTE FUNCTION fail_transfer_credit()`
    );
    try {
      expect((await request(user, "POST", base, payload)).statusCode).toBe(500);
      expect(await db.transfer.count({ where: { userId: user.id } })).toBe(1);
      expect(await db.transaction.count({ where: { userId: user.id } })).toBe(
        2
      );
      expect(
        (
          await request(user, "PATCH", `${base}/${existing.id}`, {
            amountMinor: 1234567
          })
        ).statusCode
      ).toBe(500);
      expect(await transfers.get(user.id, existing.id)).toEqual(existing);
      expect(await pair(existing.id)).toEqual(originalLegs);
      expect(
        (await request(user, "DELETE", `${base}/${existing.id}`)).statusCode
      ).toBe(500);
      expect(await pair(existing.id)).toEqual(originalLegs);
      expect(await transfers.get(user.id, existing.id)).toEqual(existing);
    } finally {
      await db.$executeRawUnsafe(
        `DROP TRIGGER test_fail_credit ON "Transaction"`
      );
      await db.$executeRawUnsafe(`DROP FUNCTION fail_transfer_credit()`);
    }
    await transfers.remove(user.id, existing.id);
    await create(user, payload); // Failed attempts do not reserve the creation key.
  });
  it("serializes create/archive and edit/archive without partial balances", async () => {
    const user = await owner(),
      payload = input(user);
    const [creation] = await Promise.all([
      request(user, "POST", base, payload),
      accounts.archive(user.id, user.to)
    ]);
    expect([201, 422]).toContain(creation.statusCode);
    const amount = creation.statusCode === 201 ? 2500 : 0;
    expect(await accounts.get(user.id, user.from, "2026-02-01")).toMatchObject({
      balanceMinor: 10000 - amount
    });
    expect(await accounts.get(user.id, user.to, "2026-02-01")).toMatchObject({
      balanceMinor: amount
    });
    const next = await owner(),
      row = await create(next);
    const [edit] = await Promise.all([
      request(next, "PATCH", `${base}/${row.id}`, { amountMinor: 4000 }),
      accounts.archive(next.id, next.from)
    ]);
    expect([200, 422]).toContain(edit.statusCode);
    const current = await transfers.get(next.id, row.id);
    expect(current.amountMinor).toBe(edit.statusCode === 200 ? 4000 : 2500);
    expect(
      (await pair(row.id)).every(
        (leg) => leg.amountMinor === current.amountMinor
      )
    ).toBe(true);
    expect(await accounts.get(next.id, next.from, "2026-02-01")).toMatchObject({
      balanceMinor: 10000 - current.amountMinor
    });
    expect(await accounts.get(next.id, next.to, "2026-02-01")).toMatchObject({
      balanceMinor: current.amountMinor
    });
    expect(
      await createDashboardService(db).summary(next.id, {
        from: "2026-02-01",
        to: "2026-02-28",
        currency: "CAD",
        recentLimit: 5
      })
    ).toMatchObject({
      incomeMinor: 0,
      expensesMinor: 0,
      netMinor: 0,
      categoryBreakdown: [],
      recentTransactions: []
    });
  });
});
