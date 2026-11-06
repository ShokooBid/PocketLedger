import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { buildApp } from "../../../api/src/app.js";
import { createAuthService } from "../../../api/src/auth/service.js";
import { createAccountService } from "../../../api/src/accounts/service.js";
import { createCategoryService } from "../../../api/src/categories/service.js";
import { createPreferencesService } from "../../../api/src/preferences/service.js";
import { createTransactionService } from "../../../api/src/transactions/service.js";
import { disposableDatabase } from "../../../api/tests/support/disposable.js";
import { testConfig } from "../../../api/tests/fixtures.js";
import { createApiTransactionSource } from "../../src/transaction-api";
import {
  createTransport,
  type FetchRequest,
  type Transport
} from "../../src/auth/transport";

const database = disposableDatabase(),
  db = database.db;
let app: Awaited<ReturnType<typeof buildApp>>;
beforeAll(async () => {
  await database.start();
  const config = testConfig();
  const auth = await createAuthService(db, config, async () => {
    throw new Error("No provider calls.");
  });
  app = await buildApp(config, auth, {
    logger: false,
    rateLimitMax: 10000,
    transactions: createTransactionService(db),
    categories: createCategoryService(db),
    accounts: createAccountService(db),
    preferences: createPreferencesService(db)
  });
});
afterAll(async () => {
  try {
    await app?.close();
  } finally {
    await database.close();
  }
});

it("round-trips real merchant-free data, reconciles a lost response with the original key", async () => {
  const email = `${randomUUID()}@example.invalid`;
  const registration = await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: { email, password: "synthetic mobile passphrase" }
  });
  expect(registration.statusCode).toBe(201);
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  const category = await db.category.create({
    data: { userId: user.id, name: "Food" }
  });
  // Registration no longer chooses CAD implicitly. This fixture must complete
  // the same permanent-currency prerequisite as the real account setup flow.
  await createPreferencesService(db).update(user.id, { entryCurrency: "CAD" });
  const account = await createAccountService(db).create(user.id, {
    name: "Cash",
    type: "cash",
    currency: "CAD",
    openingDate: "2026-01-01",
    openingBalanceMinor: 10000
  });
  let loseResponse = true,
    creates = 0;
  const fetcher: FetchRequest = async (url, options) => {
    const parsed = new URL(url);
    const result = await app.inject({
      method: options.method as "GET" | "POST" | "PATCH" | "DELETE",
      url: parsed.pathname + parsed.search,
      headers: Object.fromEntries(new Headers(options.headers).entries()),
      ...(typeof options.body === "string" ? { payload: options.body } : {})
    });
    if (options.method === "POST" && parsed.pathname === "/v1/transactions") {
      creates++;
      if (loseResponse) {
        loseResponse = false;
        throw new Error("Synthetic lost response after commit");
      }
    }
    return new Response(result.body, { status: result.statusCode });
  };
  const transport = createTransport("https://api.example.invalid", fetcher);
  const client: Transport = {
    send: (method, path, schema, body) =>
      transport.send(
        method,
        path,
        schema,
        body,
        registration.json().accessToken
      )
  };
  const api = createApiTransactionSource(client);
  const original = Object.freeze({
    clientRequestId: randomUUID(),
    accountId: account.id,
    categoryId: category.id,
    direction: "expense" as const,
    amountMinor: 1250,
    date: "2026-02-01",
    note: null
  });
  await expect(api.create(original)).rejects.toMatchObject({ kind: "network" });
  expect(creates).toBe(1);
  const saved = (await api.list({ accountId: account.id })).items[0]!;
  const retry = await api.create(original);
  expect(retry.id).toBe(saved.id);
  expect(retry).not.toHaveProperty("merchant");
  expect(await db.transaction.count({ where: { userId: user.id } })).toBe(1);
  expect(
    (await createAccountService(db).get(user.id, account.id, "2026-02-01"))
      .balanceMinor
  ).toBe(8750);
  await expect(
    api.create({ ...original, amountMinor: 1 })
  ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });

  expect((await api.update(saved.id, { note: "Updated" })).note).toBe(
    "Updated"
  );
  await api.remove(saved.id);
  await expect(api.create(original)).rejects.toMatchObject({
    code: "OPERATION_ALREADY_APPLIED"
  });
});
