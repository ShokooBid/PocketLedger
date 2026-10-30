import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { createAuthService } from "../../src/auth/service.js";
import { createPreferencesService } from "../../src/preferences/service.js";
import { createTransactionService } from "../../src/transactions/service.js";
import { testConfig } from "../fixtures.js";
import { disposableDatabase } from "../support/disposable.js";

const database = disposableDatabase();
const db = database.db;
const config = { ...testConfig(), currencyPreferencesEnabled: true };
let app: Awaited<ReturnType<typeof buildApp>>;
let disabled: typeof app;
type Owner = { id: string; token: string; categoryId: string; email: string };
beforeAll(async () => {
  await database.start();
  const auth = await createAuthService(db, config, async () => {
    throw new Error("No external provider in preference tests.");
  });
  app = await buildApp(config, auth, {
    logger: false,
    rateLimitMax: 10000,
    preferences: createPreferencesService(db, true),
    transactions: createTransactionService(db, true)
  });
  disabled = await buildApp(
    { ...config, currencyPreferencesEnabled: false },
    auth,
    {
      logger: false,
      rateLimitMax: 10000,
      preferences: createPreferencesService(db, false),
      transactions: createTransactionService(db)
    }
  );
});
afterAll(async () => {
  try {
    await app?.close();
    await disabled?.close();
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
      password: "synthetic currency password"
    }
  });
  expect(result.statusCode).toBe(201);
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  const category = await db.category.create({
    data: { userId: user.id, name: "Synthetic food" }
  });
  return {
    id: user.id,
    categoryId: category.id,
    token: result.json().accessToken,
    email
  };
}
function request(
  user: Owner,
  method: "GET" | "PATCH" | "POST" | "DELETE",
  url = "/v2/preferences",
  payload?: object,
  server = app
) {
  return server.inject({
    method,
    url,
    headers: { authorization: `Bearer ${user.token}` },
    ...(payload ? { payload } : {})
  });
}
const input = (user: Owner, extra: object = {}) => ({
  direction: "expense",
  amountMinor: 1250,
  currency: "CAD",
  date: "2026-10-30",
  categoryId: user.categoryId,
  merchant: "Synthetic shop",
  note: null,
  ...extra
});

describe("gated persisted currency preferences", () => {
  it("requires verified authentication and rejects owner/lock injection and invalid currencies", async () => {
    const user = await owner();
    for (const method of ["GET", "PATCH"] as const)
      expect(
        (await app.inject({ method, url: "/v2/preferences" })).statusCode
      ).toBe(401);
    for (const payload of [
      {},
      { entryCurrency: "XYZ" },
      { entryCurrency: "cad" },
      { entryCurrency: "CAD", userId: randomUUID() },
      { entryCurrency: "USD", currencyLocked: false },
      { entryCurrency: "USD", defaultAccountId: randomUUID() }
    ])
      expect(
        (await request(user, "PATCH", undefined, payload)).statusCode
      ).toBe(422);
    expect(
      await db.financePreferences.findUnique({ where: { userId: user.id } })
    ).toBeNull();
  });

  it("starts at CAD, preserves updates across login/client recreation and isolates owners", async () => {
    const alice = await owner(),
      bob = await owner();
    expect((await request(alice, "GET")).json()).toEqual({
      entryCurrency: "CAD",
      currencyLocked: false,
      defaultAccountId: null
    });
    expect(
      (
        await request(alice, "PATCH", undefined, { entryCurrency: "KWD" })
      ).json()
    ).toMatchObject({ entryCurrency: "KWD", currencyLocked: false });
    await request(alice, "POST", "/v1/auth/logout", {});
    const login = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: alice.email, password: "synthetic currency password" }
    });
    expect(login.statusCode).toBe(200);
    const restored = { ...alice, token: login.json().accessToken };
    expect((await request(restored, "GET")).json().entryCurrency).toBe("KWD");
    expect(
      (await createPreferencesService(db, true).get(alice.id)).entryCurrency
    ).toBe("KWD");
    expect((await request(bob, "GET")).json().entryCurrency).toBe("CAD");
  });

  it("does not lock on failed saves and locks atomically on a confirmed first posting", async () => {
    const user = await owner(),
      foreign = await owner();
    await request(user, "GET");
    expect(
      (
        await request(
          user,
          "POST",
          "/v1/transactions",
          input(user, { categoryId: foreign.categoryId })
        )
      ).statusCode
    ).toBe(422);
    expect((await request(user, "GET")).json().currencyLocked).toBe(false);
    // This fails a DB CHECK after the before-insert trigger has run.
    await expect(
      db.transaction.create({
        data: {
          ...input(user),
          direction: "expense",
          userId: user.id,
          amountMinor: 0,
          date: new Date("2026-10-30T00:00:00Z")
        }
      })
    ).rejects.toThrow();
    expect((await request(user, "GET")).json().currencyLocked).toBe(false);
    const created = await request(
      user,
      "POST",
      "/v1/transactions",
      input(user)
    );
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      amountMinor: 1250,
      currency: "CAD"
    });
    expect((await request(user, "GET")).json().currencyLocked).toBe(true);
    expect(
      (await request(user, "PATCH", undefined, { entryCurrency: "USD" })).json()
        .error.code
    ).toBe("CURRENCY_LOCKED");
    expect(
      (await request(user, "PATCH", undefined, { entryCurrency: "CAD" }))
        .statusCode
    ).toBe(200);
    expect(
      (
        await request(user, "PATCH", `/v1/transactions/${created.json().id}`, {
          currency: "USD"
        })
      ).json().error.code
    ).toBe("CURRENCY_IMMUTABLE");
    expect(
      (
        await request(user, "PATCH", `/v1/transactions/${created.json().id}`, {
          note: "Edited note"
        })
      ).statusCode
    ).toBe(200);
    await request(user, "DELETE", `/v1/transactions/${created.json().id}`);
    expect((await request(user, "GET")).json()).toMatchObject({
      entryCurrency: "CAD",
      currencyLocked: true
    });
    await expect(
      db.financePreferences.update({
        where: { userId: user.id },
        data: { currencyLockedAt: null }
      })
    ).rejects.toThrow();
  });

  it("rejects wrong-currency writes even if a client skips reading preferences", async () => {
    const user = await owner();
    expect(
      (
        await request(
          user,
          "POST",
          "/v1/transactions",
          input(user, { currency: "USD" })
        )
      ).json().error.code
    ).toBe("CURRENCY_MISMATCH");
    expect(await db.transaction.count({ where: { userId: user.id } })).toBe(0);
    expect((await request(user, "GET")).json()).toMatchObject({
      entryCurrency: "CAD",
      currencyLocked: false
    });
  });

  it("serializes concurrent currency changes and first postings without mismatched committed data", async () => {
    for (let i = 0; i < 4; i++) {
      const user = await owner();
      await request(user, "GET");
      const [change, create] = await Promise.all([
        request(user, "PATCH", undefined, { entryCurrency: "EUR" }),
        request(user, "POST", "/v1/transactions", input(user))
      ]);
      const saved = await db.transaction.findMany({
        where: { userId: user.id }
      });
      const preferences = (await request(user, "GET")).json();
      if (create.statusCode === 201) {
        expect(change.statusCode).toBe(409);
        expect(preferences).toMatchObject({
          entryCurrency: "CAD",
          currencyLocked: true
        });
        expect(saved).toHaveLength(1);
        expect(saved[0]!.currency).toBe("CAD");
      } else {
        expect(change.statusCode).toBe(200);
        expect(create.statusCode).toBe(422);
        expect(preferences).toMatchObject({
          entryCurrency: "EUR",
          currencyLocked: false
        });
        expect(saved).toHaveLength(0);
      }
    }
  });

  it("keeps the default rollout dormant and never relabels or deletes legacy test rows", async () => {
    const user = await owner();
    const result = await request(
      user,
      "POST",
      "/v1/transactions",
      input(user, { currency: "USD" }),
      disabled
    );
    expect(result.statusCode).toBe(201);
    expect(
      (await request(user, "GET", undefined, undefined, disabled)).json().error
        .code
    ).toBe("FINANCE_FEATURE_DISABLED");
    expect(
      await db.financePreferences.findUnique({ where: { userId: user.id } })
    ).toBeNull();
    expect((await request(user, "GET")).json().error.code).toBe(
      "CURRENCY_SETUP_REQUIRED"
    );
    expect(
      await db.transaction.findUniqueOrThrow({
        where: { id: result.json().id }
      })
    ).toMatchObject({ currency: "USD", amountMinor: 1250 });
  });

  it("enforces activated currency and permanent locks for direct database postings", async () => {
    const user = await owner();
    await request(user, "GET");
    await expect(
      db.transaction.create({
        data: {
          ...input(user),
          userId: user.id,
          direction: "expense",
          currency: "USD",
          date: new Date("2026-10-30T00:00:00Z")
        }
      })
    ).rejects.toThrow();
    await db.transaction.create({
      data: {
        ...input(user),
        userId: user.id,
        direction: "expense",
        date: new Date("2026-10-30T00:00:00Z")
      }
    });
    expect((await request(user, "GET")).json().currencyLocked).toBe(true);
    await expect(
      db.financePreferences.update({
        where: { userId: user.id },
        data: { entryCurrency: "USD" }
      })
    ).rejects.toThrow();
    // Disabling the rollout cannot bypass a previously activated owner's lock.
    expect(
      (
        await request(
          user,
          "POST",
          "/v1/transactions",
          input(user, { currency: "USD" }),
          disabled
        )
      ).statusCode
    ).toBe(422);
  });
});
