import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../../api/src/app.js";
import { createAuthService } from "../../../api/src/auth/service.js";
import { createPreferencesService } from "../../../api/src/preferences/service.js";
import { createTransactionService } from "../../../api/src/transactions/service.js";
import { testConfig } from "../../../api/tests/fixtures.js";
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
  const config = { ...testConfig(), currencyPreferencesEnabled: true };
  const auth = await createAuthService(db, config, async () => {
    throw new Error("No provider");
  });
  app = await buildApp(config, auth, {
    logger: false,
    preferences: createPreferencesService(db, true),
    transactions: createTransactionService(db, true)
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
async function owner() {
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
  return { client, categoryId: category.id };
}

describe("mobile currency contracts against real API/PostgreSQL", () => {
  it("round-trips CAD exactly and enforces the first-save lock through real adapters", async () => {
    const user = await owner();
    const preferences = createApiPreferencesSource(user.client);
    expect(await preferences.get()).toMatchObject({
      entryCurrency: "CAD",
      currencyLocked: false
    });
    expect(await preferences.update("KWD")).toMatchObject({
      entryCurrency: "KWD",
      currencyLocked: false
    });
    expect(await createApiPreferencesSource(user.client).get()).toMatchObject({
      entryCurrency: "KWD"
    });
    await preferences.update("CAD");
    const transactions = createApiTransactionSource(user.client);
    const created = await transactions.create({
      categoryId: user.categoryId,
      amountMinor: parseAmount("123.45", "CAD"),
      currency: "CAD",
      direction: "expense",
      date: "2026-10-30",
      merchant: "Synthetic mobile shop",
      note: null
    });
    expect(amountText(created.amountMinor, created.currency)).toBe("123.45");
    expect(await preferences.get()).toMatchObject({
      entryCurrency: "CAD",
      currencyLocked: true
    });
    await expect(preferences.update("USD")).rejects.toMatchObject({
      code: "CURRENCY_LOCKED"
    });
    await transactions.remove(created.id);
    expect(await preferences.get()).toMatchObject({
      entryCurrency: "CAD",
      currencyLocked: true
    });
    expect(
      await createApiPreferencesSource((await owner()).client).get()
    ).toMatchObject({ entryCurrency: "CAD", currencyLocked: false });
  });
});
