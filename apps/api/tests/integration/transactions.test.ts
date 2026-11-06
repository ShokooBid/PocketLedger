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
async function owner(currency: "CAD" | "JPY" | "KWD" = "CAD"): Promise<Owner> {
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
  await preferences.update(id, { entryCurrency: currency });
  const account = await accounts.create(id, {
    name: "Cash",
    type: "cash",
    currency,
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
  it.each(["CAD", "JPY", "KWD"] as const)(
    "derives %s on every read and keeps exact minor-unit totals after archival",
    async (currency) => {
      const user = await owner(currency);
      const payload = input(user, { amountMinor: 1001 });
      const created = await request(user, "POST", base, payload);
      expect(created.statusCode, created.body).toBe(201);
      const id = created.json().id;
      expect(created.json()).toMatchObject({ currency, amountMinor: 1001 });
      await accounts.archive(user.id, user.accountId);
      expect((await request(user, "POST", base, payload)).json()).toMatchObject(
        { id, currency, amountMinor: 1001 }
      );
      expect(
        (
          await request(user, "PATCH", `${base}/${id}`, { note: "History" })
        ).json()
      ).toMatchObject({ id, currency, amountMinor: 1001 });
      expect(
        (await request(user, "GET", `${base}/${id}`)).json()
      ).toMatchObject({ id, currency, amountMinor: 1001 });
      expect(
        (await request(user, "GET", `${base}?currency=${currency}`)).json()
          .items
      ).toHaveLength(1);
      expect(
        (await request(user, "GET", `${base}?currency=USD`)).json().items
      ).toEqual([]);
      expect(
        (await accounts.get(user.id, user.accountId, "2026-02-01")).balanceMinor
      ).toBe(8999);
      const dashboard = createDashboardService(db);
      expect(
        await dashboard.summary(user.id, {
          from: "2026-02-01",
          to: "2026-02-01",
          currency,
          recentLimit: 5
        })
      ).toMatchObject({
        expensesMinor: 1001,
        netMinor: -1001,
        recentTransactions: [{ id, currency }]
      });
      expect(
        await dashboard.summary(user.id, {
          from: "2026-02-01",
          to: "2026-02-01",
          currency: "USD",
          recentLimit: 5
        })
      ).toMatchObject({ expensesMinor: 0, recentTransactions: [] });
    }
  );

  it("rejects cross-currency reassignment in the API and SQL without changing the amount", async () => {
    const user = await owner();
    // Synthetic historical state, unreachable through today's account-create API.
    // Only this suite's disposable schema is touched. Restore the account guard
    // before testing either write path; the posting guard is always enabled.
    const otherAccount = await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        'ALTER TABLE "Account" DISABLE TRIGGER "Account_rules"'
      );
      const row = await tx.account.create({
        data: {
          userId: user.id,
          name: "Historical JPY",
          type: "cash",
          currency: "JPY",
          openingDate: new Date("2026-01-01"),
          openingBalanceMinor: 0
        }
      });
      await tx.$executeRawUnsafe(
        'ALTER TABLE "Account" ENABLE TRIGGER "Account_rules"'
      );
      return row;
    });
    const row = await create(user, { amountMinor: 1234 });
    const rejected = await request(user, "PATCH", `${base}/${row.id}`, {
      accountId: otherAccount.id,
      amountMinor: 999
    });
    expect(rejected.statusCode).toBe(422);
    expect(rejected.json().error.code).toBe("CURRENCY_MISMATCH");
    await expect(
      db.transaction.update({
        where: { id: row.id },
        data: { accountId: otherAccount.id, amountMinor: 999 }
      })
    ).rejects.toThrow();
    expect(await service.get(user.id, row.id)).toMatchObject({
      accountId: user.accountId,
      currency: "CAD",
      amountMinor: 1234
    });
  });

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
  it("stores no synthetic merchant, retains permanent currency, and computes exact signed as-of balances", async () => {
    const user = await owner();
    expect((await preferences.get(user.id)).entryCurrency).toBe("CAD");
    const row = await create(user, { note: "Weekly groceries" });
    const stored = await db.transaction.findUniqueOrThrow({
      where: { id: row.id }
    });
    expect(stored.merchant).toBeNull();
    expect(stored).not.toHaveProperty("currency");
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
  it("rejects foreign/missing/archived/wrong-currency/predating associations without creating identity records", async () => {
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
    await expect(
      preferences.update(user.id, { entryCurrency: "USD" })
    ).rejects.toMatchObject({ code: "CURRENCY_LOCKED" });
    expect(
      (
        await request(user, "POST", base, input(user, { currency: "USD" }))
      ).json().error.code
    ).toBe("VALIDATION_ERROR");
    await accounts.archive(user.id, user.accountId);
    expect(
      (await request(user, "POST", base, input(user))).json().error.code
    ).toBe("INVALID_ACCOUNT");
    expect((await preferences.get(user.id)).entryCurrency).toBe("CAD");
    expect(await db.transaction.count({ where: { userId: user.id } })).toBe(0);
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
    ).toBe("VALIDATION_ERROR");
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
    expect((await preferences.get(user.id)).entryCurrency).toBe("CAD");
  });
  it("serializes duplicate creates, isolates keys by owner and releases identity after hard deletion", async () => {
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
    const recreated = await request(user, "POST", base, payload);
    expect(recreated.statusCode, recreated.body).toBe(201);
    expect(recreated.json().id).not.toBe(id);
    expect(await db.transaction.count({ where: { userId: user.id } })).toBe(1);
    const changedAfterDelete = input(user, {
      clientRequestId: payload.clientRequestId,
      amountMinor: 1
    });
    await request(user, "DELETE", `${base}/${recreated.json().id}`);
    expect(
      (await request(user, "POST", base, changedAfterDelete)).statusCode
    ).toBe(201);
  });

  it("returns a stable conflict when different creation intents race for the same key", async () => {
    const user = await owner();
    const payload = input(user);
    const responses = await Promise.all([
      request(user, "POST", base, payload),
      request(user, "POST", base, { ...payload, amountMinor: 1 })
    ]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([
      201, 409
    ]);
    expect(
      responses.find((response) => response.statusCode === 409)!.json().error
        .code
    ).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(await db.transaction.count({ where: { userId: user.id } })).toBe(1);
  });

  it("retains original identity through edits and returns current state on equivalent retries", async () => {
    const user = await owner();
    const payload = input(user, { note: "" });
    const created = await request(user, "POST", base, payload);
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json().id;
    const initial = await db.transaction.findUniqueOrThrow({ where: { id } });
    expect(initial.clientRequestId).toBe(payload.clientRequestId);
    expect(initial.creationFingerprint).toMatch(/^[0-9a-f]{64}$/);
    const moved = await accounts.create(user.id, {
      name: "Second cash",
      type: "cash",
      currency: "CAD",
      openingDate: "2026-01-01",
      openingBalanceMinor: 0
    });
    const edited = await request(user, "PATCH", `${base}/${id}`, {
      amountMinor: 999,
      note: "Edited",
      accountId: moved.id
    });
    expect(edited.statusCode, edited.body).toBe(200);
    await accounts.archive(user.id, user.accountId);
    await db.category.update({
      where: { id: user.categoryId },
      data: { archivedAt: new Date() }
    });
    const retry = await request(user, "POST", base, {
      ...payload,
      accountId: payload.accountId.toUpperCase(),
      categoryId: payload.categoryId.toUpperCase(),
      clientRequestId: payload.clientRequestId.toUpperCase(),
      note: null
    });
    expect(retry.statusCode, retry.body).toBe(200);
    expect(retry.json()).toEqual(edited.json());
    const stored = await db.transaction.findUniqueOrThrow({ where: { id } });
    expect(stored.clientRequestId).toBe(initial.clientRequestId);
    expect(stored.creationFingerprint).toBe(initial.creationFingerprint);
    expect(
      (
        await request(user, "POST", base, {
          ...payload,
          amountMinor: 999,
          note: "Edited",
          accountId: moved.id
        })
      ).json().error.code
    ).toBe("IDEMPOTENCY_KEY_REUSED");
    for (const field of ["clientRequestId", "creationFingerprint"]) {
      expect(created.json()).not.toHaveProperty(field);
      expect(
        (
          await request(user, "PATCH", `${base}/${id}`, {
            [field]: field === "clientRequestId" ? randomUUID() : "a".repeat(64)
          })
        ).statusCode
      ).toBe(422);
    }
  });
  it("enforces account/date/currency rules in direct writes and serializes archive/create races", async () => {
    const user = await owner(),
      other = await owner();
    const fields = {
      accountId: user.accountId,
      categoryId: user.categoryId,
      amountMinor: 1250,
      date: "2026-02-01"
    };
    for (const extra of [
      { accountId: other.accountId },
      { date: new Date("2025-12-31") }
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
    expect([post.statusCode, change.statusCode]).toEqual([201, 409]);
    const racing = await owner();
    const [createResult] = await Promise.all([
      request(racing, "POST", base, input(racing)),
      accounts.archive(racing.id, racing.accountId)
    ]);
    expect([201, 422]).toContain(createResult.statusCode);
  });
});
