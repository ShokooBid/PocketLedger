import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../../api/src/app.js";
import { createAuthService } from "../../../api/src/auth/service.js";
import { createPreferencesService } from "../../../api/src/preferences/service.js";
import { createAccountService } from "../../../api/src/accounts/service.js";
import { createTransactionService } from "../../../api/src/transactions/service.js";
import { testConfig, testAccount } from "../../../api/tests/fixtures.js";
import { disposableDatabase } from "../../../api/tests/support/disposable.js";
import { createApiPreferencesSource } from "../../src/preference-data";
import { createApiTransactionSource } from "../../src/transaction-api";
import {
  createTransport,
  type FetchRequest,
  type Transport
} from "../../src/auth/transport";
import { amountText, parseAmount } from "../../src/transaction-data";

const database = disposableDatabase();
const db = database.db;
let app: Awaited<ReturnType<typeof buildApp>>;
beforeAll(async () => {
  await database.start();
  const config = testConfig();
  const auth = await createAuthService(db, config, async () => {
    throw new Error("No provider");
  });
  app = await buildApp(config, auth, {
    logger: false,
    preferences: createPreferencesService(db),
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

const fetcher: FetchRequest = async (input, options) => {
  const url = new URL(String(input));
  const result = await app.inject({
    method: (options?.method ?? "GET") as "GET" | "PATCH" | "POST" | "DELETE",
    url: url.pathname + url.search,
    headers: Object.fromEntries(new Headers(options?.headers).entries()),
    ...(typeof options?.body === "string" ? { payload: options.body } : {})
  });
  return new Response(result.body, { status: result.statusCode });
};
async function owner(withAccount = true) {
  const email = `${randomUUID()}@example.invalid`;
  const registered = await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: { email, password: "synthetic mobile currency password" }
  });
  expect(registered.statusCode).toBe(201);
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  const category = await db.category.create({
    data: { userId: user.id, name: "Mobile currency food" }
  });
  const transport = createTransport("https://api.example.invalid", fetcher);
  const client: Transport = {
    send: (method, path, schema, body) =>
      transport.send(method, path, schema, body, registered.json().accessToken)
  };
  return {
    client,
    categoryId: category.id,
    id: user.id,
    accountId: withAccount ? (await testAccount(db, user.id)).id : null
  };
}

describe("mobile permanent currency contracts against real API/PostgreSQL", () => {
  it("keeps an explicit default while rejecting currency changes before any transaction", async () => {
    const user = await owner();
    const account = await createAccountService(db).create(user.id, {
      name: "User cash",
      type: "cash",
      currency: "CAD",
      openingDate: "2026-01-01",
      openingBalanceMinor: -100
    });
    const source = createApiPreferencesSource(user.client);
    expect(await source.selectAccount(account.id)).toMatchObject({
      entryCurrency: "CAD",
      hasActiveAccounts: true,
      defaultAccountId: account.id
    });
    await expect(source.update("USD")).rejects.toMatchObject({
      code: "CURRENCY_LOCKED"
    });
    expect((await source.get()).defaultAccountId).toBe(account.id);
  });

  it("returns an unset choice, confirms once, and round-trips exact amounts through real adapters", async () => {
    const user = await owner(false);
    const preferences = createApiPreferencesSource(user.client);
    expect(await preferences.get()).toEqual({
      entryCurrency: null,
      hasActiveAccounts: false,
      defaultAccountId: null
    });
    expect(await preferences.update("CAD")).toMatchObject({
      entryCurrency: "CAD",
      hasActiveAccounts: false
    });
    expect(await preferences.update("CAD")).toMatchObject({
      entryCurrency: "CAD"
    });
    await expect(preferences.update("KWD")).rejects.toMatchObject({
      code: "CURRENCY_LOCKED"
    });
    const account = await testAccount(db, user.id);
    const transactions = createApiTransactionSource(user.client);
    const created = await transactions.create({
      categoryId: user.categoryId,
      accountId: account.id,
      amountMinor: parseAmount("123.45", "CAD"),
      currency: "CAD",
      direction: "expense",
      date: "2026-10-30",
      clientRequestId: randomUUID(),
      note: null
    });
    expect(amountText(created.amountMinor, created.currency)).toBe("123.45");
    expect(await preferences.get()).toMatchObject({
      entryCurrency: "CAD",
      hasActiveAccounts: true
    });
    await transactions.remove(created.id);
    await createAccountService(db).archive(user.id, account.id);
    expect(await preferences.get()).toMatchObject({
      entryCurrency: "CAD",
      hasActiveAccounts: false
    });
    await expect(preferences.update("USD")).rejects.toMatchObject({
      code: "CURRENCY_LOCKED"
    });
    expect(
      await createApiPreferencesSource((await owner(false)).client).get()
    ).toMatchObject({ entryCurrency: null, hasActiveAccounts: false });
  });
});
