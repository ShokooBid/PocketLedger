import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import pg from "pg";
import { expect, it } from "vitest";
import { disposableDatabase } from "../support/disposable.js";

it("expands an existing ledger without changing historical rows or provisioning accounts", async () => {
  const database = disposableDatabase({ migrate: false });
  const sql = new pg.Client({ connectionString: database.url });
  let connected = false;
  try {
    await database.start();
    await sql.connect();
    connected = true;
    const root = new URL("../../prisma/migrations/", import.meta.url);
    const target = "20261031000000_named_accounts";
    const migrations = (await readdir(root))
      .filter((name) => /^\d/.test(name) && name < target)
      .sort();
    for (const name of migrations)
      await sql.query(
        await readFile(new URL(`${name}/migration.sql`, root), "utf8")
      );
    const userId = randomUUID(),
      categoryId = randomUUID();
    await sql.query('INSERT INTO "User" (id, email) VALUES ($1, $2)', [
      userId,
      `${userId}@example.invalid`
    ]);
    await sql.query(
      'INSERT INTO "Category" (id, "userId", name) VALUES ($1, $2, $3)',
      [categoryId, userId, "Historical"]
    );
    // Existing mixed-currency history remains unassigned and unrelabelled.
    for (const currency of ["CAD", "USD"])
      await sql.query(
        `INSERT INTO "Transaction" ("userId", "categoryId", direction, "amountMinor", currency, date, merchant, note)
        VALUES ($1, $2, 'expense', 1234, $3, '2026-01-01', 'Historical merchant', 'Historical note')`,
        [userId, categoryId, currency]
      );
    const preferencesUserId = randomUUID();
    await sql.query('INSERT INTO "User" (id, email) VALUES ($1, $2)', [
      preferencesUserId,
      `${preferencesUserId}@example.invalid`
    ]);
    await sql.query(
      'INSERT INTO "FinancePreferences" ("userId", "entryCurrency") VALUES ($1, $2)',
      [preferencesUserId, "EUR"]
    );
    const transactions = (
      await sql.query('SELECT * FROM "Transaction" ORDER BY id')
    ).rows;
    const categories = (await sql.query('SELECT * FROM "Category" ORDER BY id'))
      .rows;
    const preferences = (await sql.query('SELECT * FROM "FinancePreferences"'))
      .rows;
    await sql.query(
      await readFile(new URL(`${target}/migration.sql`, root), "utf8")
    );
    expect(
      (await sql.query('SELECT * FROM "Transaction" ORDER BY id')).rows
    ).toEqual(transactions);
    expect(
      (await sql.query('SELECT * FROM "Category" ORDER BY id')).rows
    ).toEqual(categories);
    expect(
      (await sql.query('SELECT * FROM "FinancePreferences"')).rows
    ).toEqual(preferences.map((row) => ({ ...row, defaultAccountId: null })));
    expect(
      (await sql.query('SELECT count(*)::int AS count FROM "Account"')).rows
    ).toEqual([{ count: 0 }]);
  } finally {
    try {
      if (connected) await sql.end();
    } finally {
      await database.close();
    }
  }
});
