import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { createAuthService } from "../../src/auth/service.js";
import { createPreferencesService } from "../../src/preferences/service.js";
import { createAccountService } from "../../src/accounts/service.js";
import { createTransactionService } from "../../src/transactions/service.js";
import { testConfig } from "../fixtures.js";
import { disposableDatabase } from "../support/disposable.js";

const database = disposableDatabase();
const db = database.db;
const preferences = createPreferencesService(db);
const accounts = createAccountService(db);
let app: Awaited<ReturnType<typeof buildApp>>;
type Owner = { id: string; token: string; email: string };

beforeAll(async () => {
  await database.start();
  const config = testConfig();
  const auth = await createAuthService(db, config, async () => {
    throw new Error("No provider calls.");
  });
  app = await buildApp(config, auth, {
    logger: false,
    rateLimitMax: 10000,
    preferences,
    accounts,
    transactions: createTransactionService(db)
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
  const result = await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: {
      email,
      password: "synthetic permanent currency password"
    }
  });
  expect(result.statusCode).toBe(201);
  return {
    id: (await db.user.findUniqueOrThrow({ where: { email } })).id,
    token: result.json().accessToken,
    email
  };
}
function request(
  user: Owner,
  method: "GET" | "PATCH" | "POST" | "DELETE",
  url = "/v1/preferences",
  payload?: object
) {
  return app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${user.token}` },
    ...(payload ? { payload } : {})
  });
}
const accountInput = {
  name: "First cash",
  type: "cash" as const,
  currency: "CAD" as const,
  openingDate: "2026-01-01",
  openingBalanceMinor: 0
};

describe("permanent currency and derived account readiness", () => {
  it("authenticates before validation and rejects forged or invalid choices", async () => {
    for (const method of ["GET", "PATCH"] as const)
      expect(
        (await app.inject({ method, url: "/v1/preferences" })).statusCode
      ).toBe(401);
    const user = await owner();
    for (const payload of [
      {},
      { entryCurrency: "XYZ" },
      { entryCurrency: "cad" },
      { entryCurrency: null },
      { entryCurrency: "CAD", userId: randomUUID() },
      { entryCurrency: "CAD", currencyLocked: false },
      { hasActiveAccounts: true },
      { defaultAccountId: "invalid" }
    ])
      expect(
        (await request(user, "PATCH", undefined, payload)).statusCode
      ).toBe(422);
    expect((await preferences.get(user.id)).entryCurrency).toBeNull();
  });

  it("reading never chooses CAD and saving the initial choice is permanent before any account/posting", async () => {
    const user = await owner();
    expect((await request(user, "GET")).json()).toEqual({
      entryCurrency: null,
      hasActiveAccounts: false,
      defaultAccountId: null
    });
    expect(
      (
        await db.financePreferences.findUniqueOrThrow({
          where: { userId: user.id }
        })
      ).entryCurrency
    ).toBeNull();
    expect(
      (await request(user, "PATCH", undefined, { entryCurrency: "CAD" })).json()
    ).toEqual({
      entryCurrency: "CAD",
      hasActiveAccounts: false,
      defaultAccountId: null
    });
    expect(
      (await request(user, "PATCH", undefined, { entryCurrency: "CAD" }))
        .statusCode
    ).toBe(200);
    const change = await request(user, "PATCH", undefined, {
      entryCurrency: "KWD"
    });
    expect(change.statusCode).toBe(409);
    expect(change.json().error.code).toBe("CURRENCY_LOCKED");
    expect(await db.account.count({ where: { userId: user.id } })).toBe(0);
    expect(await db.transaction.count({ where: { userId: user.id } })).toBe(0);
  });

  it("persists across login/service recreation and isolates users", async () => {
    const alice = await owner(),
      bob = await owner();
    await request(alice, "PATCH", undefined, { entryCurrency: "KWD" });
    await request(alice, "POST", "/v1/auth/logout", {});
    const login = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: {
        email: alice.email,
        password: "synthetic permanent currency password"
      }
    });
    expect(login.statusCode).toBe(200);
    expect(
      (
        await request({ ...alice, token: login.json().accessToken }, "GET")
      ).json().entryCurrency
    ).toBe("KWD");
    expect(
      (await createPreferencesService(db).get(alice.id)).entryCurrency
    ).toBe("KWD");
    expect((await preferences.get(bob.id)).entryCurrency).toBeNull();
  });

  it("requires currency before accounts in the API and direct database writes, including a null preference row", async () => {
    const user = await owner();
    expect(
      (await request(user, "POST", "/v1/accounts", accountInput)).json().error
        .code
    ).toBe("CURRENCY_REQUIRED");
    await expect(
      db.account.create({
        data: {
          ...accountInput,
          userId: user.id,
          openingDate: new Date("2026-01-01")
        }
      })
    ).rejects.toThrow();
    await preferences.update(user.id, { entryCurrency: "CAD" });
    expect(
      (
        await request(user, "POST", "/v1/accounts", {
          ...accountInput,
          currency: "USD"
        })
      ).json().error.code
    ).toBe("PREFERENCE_CHANGED");
    const account = await request(user, "POST", "/v1/accounts", accountInput);
    expect(account.statusCode).toBe(201);
    expect(account.json().currency).toBe("CAD");
    expect(await preferences.get(user.id)).toMatchObject({
      hasActiveAccounts: true,
      defaultAccountId: null
    });
  });

  it("derives readiness after archival/replacement without deleting history or requiring a default", async () => {
    const user = await owner();
    await preferences.update(user.id, { entryCurrency: "CAD" });
    const account = await accounts.create(user.id, accountInput);
    const category = await db.category.create({
      data: { userId: user.id, name: "Setup food" }
    });
    const transaction = await db.transaction.create({
      data: {
        userId: user.id,
        accountId: account.id,
        categoryId: category.id,
        direction: "expense",
        amountMinor: 1250,
        currency: "CAD",
        date: new Date("2026-11-05")
      }
    });
    await preferences.update(user.id, { defaultAccountId: account.id });
    await accounts.archive(user.id, account.id);
    expect(await preferences.get(user.id)).toEqual({
      entryCurrency: "CAD",
      hasActiveAccounts: false,
      defaultAccountId: null
    });
    expect(
      await db.transaction.findUnique({ where: { id: transaction.id } })
    ).not.toBeNull();
    const rejected = await request(user, "POST", "/v1/transactions", {
      accountId: account.id,
      categoryId: category.id,
      direction: "expense",
      amountMinor: 1,
      currency: "CAD",
      date: "2026-11-05",
      note: null,
      clientRequestId: randomUUID()
    });
    expect(rejected.json().error.code).toBe("INVALID_ACCOUNT");
    await accounts.create(user.id, { ...accountInput, name: "Replacement" });
    expect(await preferences.get(user.id)).toMatchObject({
      hasActiveAccounts: true,
      defaultAccountId: null
    });
    await db.transaction.delete({ where: { id: transaction.id } });
    await expect(
      preferences.update(user.id, { entryCurrency: "USD" })
    ).rejects.toMatchObject({ code: "CURRENCY_LOCKED" });
  });

  it("serializes conflicting first choices and accepts identical concurrent retries", async () => {
    const user = await owner();
    const replies = await Promise.all([
      request(user, "PATCH", undefined, { entryCurrency: "CAD" }),
      request(user, "PATCH", undefined, { entryCurrency: "KWD" })
    ]);
    expect(replies.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    const chosen = (await preferences.get(user.id)).entryCurrency;
    const retries = await Promise.all([
      request(user, "PATCH", undefined, { entryCurrency: chosen }),
      request(user, "PATCH", undefined, { entryCurrency: chosen })
    ]);
    expect(retries.map((r) => r.statusCode)).toEqual([200, 200]);
  });

  it("enforces write-once identity against direct updates, clearing, deletion and concurrent choices", async () => {
    const user = await owner(),
      other = await owner();
    await preferences.get(user.id);
    const results = await Promise.allSettled(
      ["CAD", "USD"].map((entryCurrency) =>
        db.financePreferences.update({
          where: { userId: user.id },
          data: { entryCurrency }
        })
      )
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const chosen = (await preferences.get(user.id)).entryCurrency!;
    await db.financePreferences.update({
      where: { userId: user.id },
      data: { entryCurrency: chosen }
    });
    for (const data of [
      { entryCurrency: null },
      { entryCurrency: chosen === "CAD" ? "USD" : "CAD" },
      { userId: other.id }
    ])
      await expect(
        db.financePreferences.update({ where: { userId: user.id }, data })
      ).rejects.toThrow();
    await expect(
      db.financePreferences.delete({ where: { userId: user.id } })
    ).rejects.toThrow();
  });
});
