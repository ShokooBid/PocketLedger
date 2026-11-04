import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { createAuthService } from "../../src/auth/service.js";
import { createAccountService } from "../../src/accounts/service.js";
import { createPreferencesService } from "../../src/preferences/service.js";
import { createTransactionService } from "../../src/transactions/service.js";
import { createCategoryService } from "../../src/categories/service.js";
import { createDashboardService } from "../../src/dashboard/service.js";
import { testConfig } from "../fixtures.js";
import { disposableDatabase } from "../support/disposable.js";

const database = disposableDatabase(),
  db = database.db;
const accounts = createAccountService(db),
  preferences = createPreferencesService(db);
const service = createTransactionService(db);
let app: Awaited<ReturnType<typeof buildApp>>;
const base = "/v1/transactions";
type Owner = {
  id: string;
  token: string;
  categoryId: string;
  accountId: string;
};
beforeAll(async () => {
  await database.start();
  const config = testConfig();
  const auth = await createAuthService(db, config, async () => {
    throw new Error("No provider calls.");
  });
  app = await buildApp(config, auth, {
    logger: false,
    rateLimitMax: 10000,
    accounts,
    preferences,
    transactions: service,
    categories: createCategoryService(db),
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
  const email = `${randomUUID()}@example.invalid`;
  const response = await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: { email, password: "synthetic transaction password" }
  });
  expect(response.statusCode, response.body).toBe(201);
  const { id } = await db.user.findUniqueOrThrow({ where: { email } });
  const category = await db.category.create({
    data: { userId: id, name: "Food" }
  });
  const account = await accounts.create(id, {
    name: "Cash",
    type: "cash",
    currency: "CAD",
    openingDate: "2026-01-01",
    openingBalanceMinor: 10000
  });
  return {
    id,
    token: response.json().accessToken,
    categoryId: category.id,
    accountId: account.id
  };
}
const input = (user: Owner, extra: object = {}) => ({
  clientRequestId: randomUUID(),
  accountId: user.accountId,
  categoryId: user.categoryId,
  direction: "expense",
  amountMinor: 1250,
  currency: "CAD",
  date: "2026-02-01",
  ...extra
});
const request = (
  user: Owner,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  url = base,
  payload?: object
) =>
  app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${user.token}` },
    ...(payload ? { payload } : {})
  });
async function create(user: Owner, extra: object = {}) {
  const response = await request(user, "POST", base, input(user, extra));
  expect(response.statusCode, response.body).toBe(201);
  return response.json() as { id: string; accountId: string; currency: string };
}

describe("account-aware transactions", () => {
  it("authenticates before validation and exposes one canonical contract", async () => {
    for (const [method, url, payload] of [
      ["GET", base],
      ["GET", `${base}/bad`],
      ["POST", base, {}],
      ["PATCH", `${base}/bad`, {}],
      ["DELETE", `${base}/bad`]
    ] as const)
      expect(
        (await app.inject({ method, url, ...(payload ? { payload } : {}) }))
          .statusCode
      ).toBe(401);
    const user = await owner();
    expect((await request(user, "GET", "/v1/me")).statusCode).toBe(200);
    expect(app.swagger().paths?.[base]?.post?.responses?.["200"]).toBeDefined();
    expect(app.swagger().paths?.[base]?.post?.responses?.["201"]).toBeDefined();
  });
  it("stores no synthetic merchant, locks on first commit, and computes exact signed as-of balances", async () => {
    const user = await owner();
    expect((await preferences.get(user.id)).currencyLocked).toBe(false);
    const row = await create(user, { note: "Weekly groceries" });
    const stored = await db.transaction.findUniqueOrThrow({
      where: { id: row.id }
    });
    expect(stored.merchant).toBeNull();
    expect(
      (await request(user, "GET", `${base}/${row.id}`)).json()
    ).toMatchObject({
      accountId: user.accountId,
      note: "Weekly groceries",
      importId: null
    });
    expect(
      (await request(user, "GET", `${base}/${row.id}`)).json()
    ).not.toHaveProperty("merchant");
    await create(user, { amountMinor: 250, direction: "income" });
    await create(user, { date: "9999-12-31", amountMinor: 500 });
    expect(
      (await accounts.get(user.id, user.accountId, "2026-01-31")).balanceMinor
    ).toBe(10000);
    expect(
      (await accounts.get(user.id, user.accountId, "2026-02-01")).balanceMinor
    ).toBe(9000);
    expect((await accounts.get(user.id, user.accountId)).balanceMinor).toBe(
      9000
    );
    await create(user, { amountMinor: 20000 });
    expect(
      (await accounts.get(user.id, user.accountId, "2026-02-01")).balanceMinor
    ).toBe(-11000);
    await expect(
      preferences.update(user.id, { entryCurrency: "USD" })
    ).rejects.toMatchObject({ code: "CURRENCY_LOCKED" });
    const filtered = (
      await request(
        user,
        "GET",
        `${base}?accountId=${user.accountId}&direction=income&from=2026-02-01&to=2026-02-01&currency=CAD`
      )
    ).json();
    expect(filtered.items).toHaveLength(1);
    const first = (await request(user, "GET", `${base}?limit=1`)).json();
    const second = (
      await request(user, "GET", `${base}?limit=1&after=${first.nextCursor}`)
    ).json();
    expect(first.items[0].id).not.toBe(second.items[0].id);
  });
  it("rejects foreign/missing/archived/wrong-currency/predating associations without leaving locks or identity records", async () => {
    const user = await owner(),
      other = await owner();
    const foreign = await request(
      user,
      "POST",
      base,
      input(user, { accountId: other.accountId })
    );
    const absent = await request(
      user,
      "POST",
      base,
      input(user, { accountId: randomUUID() })
    );
    expect([foreign.statusCode, absent.statusCode]).toEqual([404, 404]);
    expect(foreign.json().error.code).toBe(absent.json().error.code);
    expect(
      (
        await request(
          user,
          "POST",
          base,
          input(user, { categoryId: other.categoryId })
        )
      ).statusCode
    ).toBe(404);
    expect(
      (
        await request(user, "POST", base, input(user, { date: "2025-12-31" }))
      ).json().error.code
    ).toBe("INVALID_ACCOUNT");
    await preferences.update(user.id, { entryCurrency: "USD" });
    expect(
      (await request(user, "POST", base, input(user))).json().error.code
    ).toBe("CURRENCY_MISMATCH");
    expect(
      (
        await request(user, "POST", base, input(user, { currency: "USD" }))
      ).json().error.code
    ).toBe("CURRENCY_MISMATCH");
    await preferences.update(user.id, { entryCurrency: "CAD" });
    await accounts.archive(user.id, user.accountId);
    expect(
      (await request(user, "POST", base, input(user))).json().error.code
    ).toBe("INVALID_ACCOUNT");
    expect((await preferences.get(user.id)).currencyLocked).toBe(false);
    expect(
      await db.transactionCreation.count({ where: { userId: user.id } })
    ).toBe(0);
    for (const id of [other.accountId, randomUUID()])
      expect(
        (await request(user, "GET", `${base}?accountId=${id}`)).statusCode
      ).toBe(404);
  });
  it("retains unchanged archived associations but validates changed assignments and dates on edits", async () => {
    const user = await owner();
    const row = await create(user);
    await accounts.archive(user.id, user.accountId);
    await db.category.update({
      where: { id: user.categoryId },
      data: { archivedAt: new Date() }
    });
    expect(
      (
        await request(user, "PATCH", `${base}/${row.id}`, {
          note: "Edited history",
          accountId: user.accountId,
          categoryId: user.categoryId
        })
      ).statusCode
    ).toBe(200);
    expect(
      (
        await request(user, "PATCH", `${base}/${row.id}`, {
          date: "2025-12-31"
        })
      ).statusCode
    ).toBe(422);
    expect(
      (
        await request(user, "PATCH", `${base}/${row.id}`, { currency: "USD" })
      ).json().error.code
    ).toBe("CURRENCY_IMMUTABLE");
    const active = await accounts.create(user.id, {
      name: "Other",
      type: "other",
      currency: "CAD",
      openingDate: "2026-01-01",
      openingBalanceMinor: 0
    });
    expect(
      (
        await request(user, "PATCH", `${base}/${row.id}`, {
          accountId: active.id
        })
      ).statusCode
    ).toBe(200);
    expect(
      (
        await request(user, "PATCH", `${base}/${row.id}`, {
          accountId: user.accountId
        })
      ).statusCode
    ).toBe(422);
    expect(
      (await request(user, "DELETE", `${base}/${row.id}`)).statusCode
    ).toBe(200);
    expect((await preferences.get(user.id)).currencyLocked).toBe(true);
  });
  it("serializes duplicate creates, isolates keys by owner, rejects changed payloads and keeps deletion tombstones", async () => {
    const user = await owner(),
      other = await owner(),
      payload = input(user);
    const responses = await Promise.all([
      request(user, "POST", base, payload),
      request(user, "POST", base, payload)
    ]);
    expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 201]);
    const id = responses[0]!.json().id;
    expect(responses[1]!.json().id).toBe(id);
    expect(await db.transaction.count({ where: { userId: user.id } })).toBe(1);
    expect(
      (await request(user, "POST", base, { ...payload, amountMinor: 1 })).json()
        .error.code
    ).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(
      (
        await request(
          other,
          "POST",
          base,
          input(other, { clientRequestId: payload.clientRequestId })
        )
      ).statusCode
    ).toBe(201);
    await request(user, "DELETE", `${base}/${id}`);
    expect((await request(user, "POST", base, payload)).json().error.code).toBe(
      "OPERATION_ALREADY_APPLIED"
    );
  });
  it("enforces account/date/currency rules in direct writes and serializes first-posting races", async () => {
    const user = await owner(),
      other = await owner();
    const fields = {
      accountId: user.accountId,
      categoryId: user.categoryId,
      amountMinor: 1250,
      currency: "CAD",
      date: "2026-02-01"
    };
    for (const extra of [
      { accountId: other.accountId },
      { date: new Date("2025-12-31") },
      { currency: "USD" }
    ])
      await expect(
        db.transaction.create({
          data: {
            ...fields,
            userId: user.id,
            direction: "expense",
            date: new Date(fields.date),
            ...extra
          }
        })
      ).rejects.toThrow();
    const [post, change] = await Promise.all([
      request(user, "POST", base, input(user)),
      request(user, "PATCH", "/v1/preferences", { entryCurrency: "USD" })
    ]);
    expect([
      [201, 409],
      [422, 200]
    ]).toContainEqual([post.statusCode, change.statusCode]);
    const racing = await owner();
    const [createResult] = await Promise.all([
      request(racing, "POST", base, input(racing)),
      accounts.archive(racing.id, racing.accountId)
    ]);
    expect([201, 422]).toContain(createResult.statusCode);
  });
});
