import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { createAuthService } from "../../src/auth/service.js";
import { createHistoryService } from "../../src/history/service.js";
import { historyPage } from "../../src/history/contracts.js";
import { createTransactionService } from "../../src/transactions/service.js";
import { createTransferService } from "../../src/transfers/service.js";
import { createAccountService } from "../../src/accounts/service.js";
import { createDashboardService } from "../../src/dashboard/service.js";
import { testAccount, testConfig } from "../fixtures.js";
import { disposableDatabase } from "../support/disposable.js";

// Written for the user to run. Only the existing disposable helper may migrate
// its own random test schema; implementing this issue does not execute it.
const database = disposableDatabase(),
  db = database.db;
const transactions = createTransactionService(db),
  transfers = createTransferService(db),
  history = createHistoryService(db);
let app: Awaited<ReturnType<typeof buildApp>>;
beforeAll(async () => {
  await database.start();
  const config = testConfig();
  const auth = await createAuthService(db, config, async () => {
    throw new Error("No provider calls");
  });
  app = await buildApp(config, auth, {
    logger: false,
    rateLimitMax: 10000,
    history
  });
});
afterAll(async () => {
  try {
    await app?.close();
  } finally {
    await database.close();
  }
});
async function owner() {
  const email = `${randomUUID()}@example.invalid`;
  const response = await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: { email, password: "synthetic history passphrase" }
  });
  expect(response.statusCode, response.body).toBe(201);
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  const account = await testAccount(db, user.id),
    destination = await testAccount(db, user.id);
  const category = await db.category.findFirstOrThrow({
    where: { userId: null, parentId: { not: null } }
  });
  return {
    id: user.id,
    token: response.json<{ accessToken: string }>().accessToken,
    account,
    destination,
    category
  };
}
type Owner = Awaited<ReturnType<typeof owner>>;
async function create(user: Owner, extra: object = {}) {
  return (
    await transactions.create(user.id, {
      accountId: user.account.id,
      categoryId: user.category.id,
      direction: "expense",
      amountMinor: 100,
      date: "2026-10-29",
      note: "Synthetic history entry",
      clientRequestId: randomUUID(),
      ...extra
    })
  ).resource;
}
async function request(user: Owner, query = "") {
  const response = await app.inject({
    method: "GET",
    url: `/v1/history${query ? `?${query}` : ""}`,
    headers: { authorization: `Bearer ${user.token}` }
  });
  expect(response.statusCode, response.body).toBe(200);
  return historyPage.parse(response.json());
}
describe("owned unified History", () => {
  it("authenticates before validation and rejects unknown/unpaired query fields", async () => {
    expect(
      (await app.inject({ method: "GET", url: "/v1/history?limit=invalid" }))
        .statusCode
    ).toBe(401);
    const user = await owner();
    for (const query of [
      "from=2026-10-01",
      "includeSubcategories=true",
      "userId=" + user.id
    ]) {
      expect(
        (
          await app.inject({
            method: "GET",
            url: `/v1/history?${query}`,
            headers: { authorization: `Bearer ${user.token}` }
          })
        ).statusCode
      ).toBe(422);
    }
  });
  it("paginates logical transfers once, merges same-day ties, and aggregates the whole filtered day", async () => {
    const user = await owner();
    await create(user);
    await create(user, { amountMinor: 200 });
    await create(user, { direction: "income", amountMinor: 1000 });
    const transfer = (
      await transfers.create(user.id, {
        fromAccountId: user.account.id,
        toAccountId: user.destination.id,
        amountMinor: 500,
        date: "2026-10-29",
        note: null,
        clientRequestId: randomUUID()
      })
    ).resource;
    // Different tables can legally contain the same UUID. The cursor kind must
    // preserve both logical rows across a page boundary.
    await db.transaction.create({
      data: {
        id: transfer.id,
        userId: user.id,
        accountId: user.account.id,
        categoryId: user.category.id,
        direction: "expense",
        amountMinor: 50,
        date: new Date("2026-10-29")
      }
    });
    const first = await request(user, "limit=2"),
      seen = [...first.items];
    expect(first.days).toEqual([
      {
        date: "2026-10-29",
        currency: "CAD",
        count: 5,
        incomeMinor: 1000,
        expensesMinor: 350,
        netMinor: 650
      }
    ]);
    let cursor = first.nextCursor;
    while (cursor) {
      const page = await request(user, `limit=2&after=${cursor}`);
      expect(page.days).toEqual(first.days);
      seen.push(...page.items);
      cursor = page.nextCursor;
    }
    expect(new Set(seen.map((row) => `${row.kind}_${row.id}`)).size).toBe(5);
    expect(seen.filter((row) => row.kind === "transfer")).toHaveLength(1);
    const destination = await request(user, `accountId=${user.destination.id}`);
    expect(destination.items.map((row) => row.id)).toEqual([transfer.id]);
    expect(destination.days[0]).toMatchObject({ count: 1, netMinor: 0 });
    const summary = await createDashboardService(db).summary(user.id, {
      from: "2026-10-29",
      to: "2026-10-29",
      currency: "CAD",
      recentLimit: 5
    });
    expect(summary).toMatchObject({
      incomeMinor: 1000,
      expensesMinor: 350,
      netMinor: 650
    });
  });
  it("supports exact/subtree filters without leaking users sharing a category", async () => {
    const alice = await owner(),
      bob = await owner();
    await create(alice);
    await create(alice, { categoryId: alice.category.parentId! });
    await create(bob, { amountMinor: 9999 });
    expect(
      (await request(alice, `categoryId=${alice.category.parentId}`)).days[0]
    ).toMatchObject({ count: 1, expensesMinor: 100 });
    const subtree = await request(
      alice,
      `categoryId=${alice.category.parentId}&includeSubcategories=true&type=expense&accountId=${alice.account.id}&from=2026-10-29&to=2026-10-29`
    );
    expect(subtree.days[0]).toMatchObject({ count: 2, expensesMinor: 200 });
    const summary = await createDashboardService(db).summary(alice.id, {
      from: "2026-10-29",
      to: "2026-10-29",
      currency: "CAD",
      recentLimit: 5
    });
    expect(summary.rootCategoryBreakdown).toEqual([
      expect.objectContaining({
        categoryId: alice.category.parentId,
        expensesMinor: 200
      })
    ]);
    const privateCategory = await db.category.create({
      data: { userId: bob.id, name: "Private history category" }
    });
    for (const query of [
      `accountId=${bob.account.id}`,
      `categoryId=${privateCategory.id}`
    ]) {
      expect(
        (
          await app.inject({
            method: "GET",
            url: `/v1/history?${query}`,
            headers: { authorization: `Bearer ${alice.token}` }
          })
        ).statusCode
      ).toBe(404);
    }
    expect((await request(alice, "currency=USD")).items).toEqual([]);
  });
  it("reveals backdated saves with explained filters and paginates toward newer records", async () => {
    const user = await owner();
    const saved = await create(user, {
      date: "2026-01-15",
      direction: "income"
    });
    await create(user);
    await create(user, { date: "2026-10-30" });
    const page = await request(
      user,
      `limit=1&from=2026-11-01&to=2026-11-30&type=expense&accountId=${user.destination.id}&focusId=${saved.id}&focusKind=transaction`
    );
    expect(page.items[0]?.id).toBe(saved.id);
    expect(page.applied).toEqual({ from: "2026-01-15", to: "2026-11-30" });
    expect(page.adjustments).toHaveLength(3);
    expect(page.previousCursor).not.toBeNull();
    const newer = await request(user, `limit=1&before=${page.previousCursor}`);
    expect(newer.items[0]?.date).toBe("2026-10-29");
    await transactions.update(user.id, saved.id, { date: "2026-10-31" });
    expect((await request(user)).items[0]?.id).toBe(saved.id);
    await transactions.remove(user.id, saved.id);
    expect((await request(user)).items.map((row) => row.id)).not.toContain(
      saved.id
    );
  });
  it("preserves archived account history and rejects foreign saved-record focus", async () => {
    const user = await owner(),
      other = await owner();
    const saved = await create(user);
    await createAccountService(db).archive(user.id, user.account.id);
    expect(
      (await request(user, `accountId=${user.account.id}`)).items[0]
    ).toMatchObject({ id: saved.id, currency: "CAD" });
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/history?focusId=${saved.id}&focusKind=transaction`,
          headers: { authorization: `Bearer ${other.token}` }
        })
      ).statusCode
    ).toBe(404);
  });
});
