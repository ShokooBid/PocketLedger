import { randomUUID } from "node:crypto";
import { Writable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { createAuthService } from "../../src/auth/service.js";
import { createDashboardService } from "../../src/dashboard/service.js";
import { summarySchema } from "../../src/dashboard/contracts.js";
import { createTransactionService } from "../../src/transactions/service.js";
import { testConfig } from "../fixtures.js";
import { disposableDatabase } from "../support/disposable.js";

const database = disposableDatabase();
const db = database.db;
let app: Awaited<ReturnType<typeof buildApp>>;
type Owner = { token: string; id: string; categoryId: string };
let alice: Owner;
let bob: Owner;
const root = "/v1/dashboard/summary";
const period = "from=2026-10-01&to=2026-10-31&currency=USD";
const logs: string[] = [];
beforeAll(async () => {
  await database.start();
  const config = testConfig();
  const auth = await createAuthService(db, config, async () => {
    throw new Error("No provider");
  });
  app = await buildApp(config, auth, {
    logger: {
      stream: new Writable({
        write(chunk, _encoding, callback) {
          logs.push(String(chunk));
          callback();
        }
      })
    },
    rateLimitMax: 10000,
    dashboard: createDashboardService(db),
    transactions: createTransactionService(db)
  });
  async function owner(): Promise<Owner> {
    const email = `${randomUUID()}@example.invalid`;
    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { email, password: "synthetic dashboard password" }
    });
    expect(response.statusCode).toBe(201);
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    const category = await db.category.create({
      data: { userId: user.id, name: "Synthetic category" }
    });
    return {
      token: response.json().accessToken as string,
      id: user.id,
      categoryId: category.id
    };
  }
  alice = await owner();
  bob = await owner();
});
afterAll(async () => {
  try {
    await app?.close();
  } finally {
    await database.close();
  }
});
function request(query = period, token = alice.token) {
  return app.inject({
    method: "GET",
    url: `${root}?${query}`,
    headers: { authorization: `Bearer ${token}` }
  });
}
async function create(owner: Owner, extra: object = {}) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/transactions",
    headers: { authorization: `Bearer ${owner.token}` },
    payload: {
      direction: "expense",
      amountMinor: 100,
      currency: "USD",
      date: "2026-10-01",
      categoryId: owner.categoryId,
      merchant: "private-dashboard-merchant",
      note: "private-dashboard-note",
      ...extra
    }
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ id: string; date: string }>();
}
describe("protected dashboard summary", () => {
  it("requires a real session, rejects invalid inputs and documents its contract", async () => {
    expect((await app.inject({ method: "GET", url: root })).statusCode).toBe(
      401
    );
    expect((await request(period, "forged")).statusCode).toBe(401);
    for (const query of [
      "",
      "from=2026-10-01&currency=USD",
      "to=2026-10-31&currency=USD",
      "from=2026-10-01&to=2026-10-31",
      "from=2026-11-01&to=2026-10-01&currency=USD",
      "from=2023-02-29&to=2023-03-01&currency=USD",
      "from=0000-01-01&to=0000-01-01&currency=USD",
      "from=2024-01-01&to=2025-01-02&currency=USD",
      "from=2026-10-01T00:00:00Z&to=2026-10-31&currency=USD",
      period.replace("USD", "ZZZ"),
      period.replace("USD", "usd"),
      `${period}&recentLimit=0`,
      `${period}&recentLimit=21`,
      `${period}&recentLimit=1.5`,
      `${period}&recentLimit=abc`,
      `${period}&userId=${bob.id}`,
      `${period}&timezone=UTC`,
      `${period}&currency=EUR`
    ])
      expect((await request(query)).statusCode, query).toBe(422);
    const operation = app.swagger().paths?.[root]?.get;
    expect(operation?.security).toEqual([{ bearerAuth: [] }]);
    expect(operation?.description).toContain("calendar");
    expect(operation?.responses).toHaveProperty("200");
    expect(operation?.responses).toHaveProperty("422");
  });
  it("returns zero totals and empty arrays for an empty period", async () => {
    const response = await request();
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toEqual({
      from: "2026-10-01",
      to: "2026-10-31",
      currency: "USD",
      incomeMinor: 0,
      expensesMinor: 0,
      netMinor: 0,
      categoryBreakdown: [],
      recentTransactions: []
    });
  });
  it("sums a single category exactly beyond a 32-bit integer", async () => {
    await create(alice, { date: "2026-09-01", amountMinor: 2147483647 });
    await create(alice, { date: "2026-09-01", amountMinor: 2147483647 });
    const response = await request(
      "from=2026-09-01&to=2026-09-01&currency=USD"
    );
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      incomeMinor: 0,
      expensesMinor: 4294967294,
      netMinor: -4294967294,
      categoryBreakdown: [
        {
          categoryId: alice.categoryId,
          incomeMinor: 0,
          expensesMinor: 4294967294,
          netMinor: -4294967294
        }
      ]
    });
  });
  it("matches mixed fixtures, includes boundaries/archived categories, separates currencies and owners", async () => {
    const salary = await db.category.create({
      data: { userId: alice.id, name: "Synthetic salary" }
    });
    const first = await create(alice, { amountMinor: 250 });
    const last = await create(alice, {
      direction: "income",
      amountMinor: 2000,
      date: "2026-10-31",
      categoryId: salary.id
    });
    const refund = await create(alice, {
      direction: "income",
      amountMinor: 50,
      date: "2026-10-15"
    });
    await db.category.update({
      where: { id: salary.id },
      data: { archivedAt: new Date() }
    });
    await create(alice, { date: "2026-09-30", amountMinor: 99999 });
    await create(alice, { date: "2026-11-01", amountMinor: 99999 });
    await create(alice, { currency: "JPY", amountMinor: 700 });
    const foreign = await create(bob, { amountMinor: 123456 });
    const response = await request();
    expect(response.statusCode).toBe(200);
    const result = summarySchema.parse(response.json());
    expect(result).toMatchObject({
      incomeMinor: 2050,
      expensesMinor: 250,
      netMinor: 1800
    });
    expect(result.recentTransactions.map((row) => row.id)).toEqual([
      last.id,
      refund.id,
      first.id
    ]);
    expect(result.categoryBreakdown).toEqual(
      [
        {
          categoryId: alice.categoryId,
          categoryName: "Synthetic category",
          incomeMinor: 50,
          expensesMinor: 250,
          netMinor: -200
        },
        {
          categoryId: salary.id,
          categoryName: "Synthetic salary",
          incomeMinor: 2000,
          expensesMinor: 0,
          netMinor: 2000
        }
      ].sort((a, b) => a.categoryId.localeCompare(b.categoryId))
    );
    expect(response.body).not.toContain(foreign.id);
    expect(response.body).not.toContain(bob.categoryId);
    expect(response.body).not.toContain("userId");
    expect((await request(period, bob.token)).json()).toMatchObject({
      incomeMinor: 0,
      expensesMinor: 123456,
      netMinor: -123456
    });
    expect((await request(period.replace("USD", "JPY"))).json()).toMatchObject({
      incomeMinor: 0,
      expensesMinor: 700,
      netMinor: -700
    });
    expect((await request(period.replace("USD", "EUR"))).json()).toMatchObject({
      incomeMinor: 0,
      expensesMinor: 0,
      netMinor: 0,
      categoryBreakdown: [],
      recentTransactions: []
    });
  });
  it("bounds recent rows, breaks same-day ties, and totals the whole period", async () => {
    const rows = [];
    for (let index = 0; index < 22; index++)
      rows.push(await create(alice, { date: "2026-08-01", amountMinor: 1 }));
    const query = "from=2026-08-01&to=2026-08-01&currency=USD";
    const ids = rows
      .map((row) => row.id)
      .sort()
      .reverse();
    for (const [suffix, count] of [
      ["", 5],
      ["&recentLimit=1", 1],
      ["&recentLimit=20", 20]
    ] as const) {
      const response = await request(query + suffix);
      expect(response.statusCode).toBe(200);
      const result = summarySchema.parse(response.json());
      expect(result.expensesMinor).toBe(22);
      expect(result.recentTransactions.map((row) => row.id)).toEqual(
        ids.slice(0, count)
      );
    }
  });
  it("uses accounting dates across leap/DST dates and the supported year bounds", async () => {
    for (const date of [
      "0001-01-01",
      "9999-12-31",
      "2024-02-29",
      "2026-03-08",
      "2026-11-01"
    ]) {
      const row = await create(alice, {
        date,
        currency: "KWD",
        amountMinor: 1234
      });
      const response = await request(`from=${date}&to=${date}&currency=KWD`);
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        expensesMinor: 1234,
        recentTransactions: [{ id: row.id, date, amountMinor: 1234 }]
      });
    }
  });
  it("keeps aggregation and recents on one snapshot during a concurrent write", async () => {
    await create(alice, { date: "2026-07-01", amountMinor: 100 });
    let inserted = false;
    const interleaved = db.$extends({
      query: {
        async $allOperations({ operation, args, query }) {
          const result = await query(args);
          if (operation === "$queryRaw" && !inserted) {
            inserted = true;
            // Commit on a separate connection after aggregation, before recents.
            await create(alice, { date: "2026-07-01", amountMinor: 200 });
          }
          return result;
        }
      }
    });
    const result = await createDashboardService(
      interleaved as unknown as typeof db
    ).summary(alice.id, {
      from: "2026-07-01",
      to: "2026-07-01",
      currency: "USD",
      recentLimit: 5
    });
    expect(inserted).toBe(true);
    expect(result.expensesMinor).toBe(100);
    expect(result.recentTransactions).toHaveLength(1);
    const next = await request("from=2026-07-01&to=2026-07-01&currency=USD");
    expect(next.json()).toMatchObject({ expensesMinor: 300 });
    expect(next.json().recentTransactions).toHaveLength(2);
  });
  it("does not log the response, financial fields, filters or credentials", async () => {
    logs.length = 0;
    const response = await request();
    const output = logs.join("");
    expect(output).toContain("request completed");
    for (const marker of [
      "incomeMinor",
      "expensesMinor",
      "recentTransactions",
      "private-dashboard-merchant",
      "private-dashboard-note",
      "2026-10-01",
      "2026-10-31",
      alice.token,
      alice.id,
      alice.categoryId,
      response.json().recentTransactions[0].id
    ])
      expect(output).not.toContain(marker);
  });
});
