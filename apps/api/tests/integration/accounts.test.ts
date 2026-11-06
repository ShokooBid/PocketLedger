import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { createAuthService } from "../../src/auth/service.js";
import { createAccountService } from "../../src/accounts/service.js";
import { createPreferencesService } from "../../src/preferences/service.js";
import { createDashboardService } from "../../src/dashboard/service.js";
import { testConfig } from "../fixtures.js";
import { disposableDatabase } from "../support/disposable.js";

const database = disposableDatabase();
const db = database.db;
const accounts = createAccountService(db);
const preferences = createPreferencesService(db);
let app: Awaited<ReturnType<typeof buildApp>>;
type Owner = { id: string; token: string };
const base = "/v1/accounts";
const input = (extra: object = {}) => ({
  name: "My bank",
  type: "bank",
  currency: "CAD",
  openingDate: "2026-01-01",
  ...extra
});
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
    preferences
  });
});
afterAll(async () => {
  try {
    await app?.close();
  } finally {
    await database.close();
  }
});
async function owner(currency: "CAD" | "USD" = "CAD"): Promise<Owner> {
  const email = `${randomUUID()}@example.invalid`;
  const response = await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: { email, password: "synthetic account passphrase" }
  });
  expect(response.statusCode, response.body).toBe(201);
  const id = (await db.user.findUniqueOrThrow({ where: { email } })).id;
  await preferences.update(id, { entryCurrency: currency });
  return {
    id,
    token: response.json().accessToken
  };
}
function request(
  user: Owner,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  url = base,
  payload?: object
) {
  return app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${user.token}` },
    ...(payload ? { payload } : {})
  });
}
async function create(user: Owner, extra: object = {}) {
  const result = await request(user, "POST", base, input(extra));
  expect(result.statusCode, result.body).toBe(201);
  return result.json() as {
    id: string;
    name: string;
    currency: string;
    openingBalanceMinor: number;
    openingDate: string;
  };
}

describe("owned named accounts and defaults", () => {
  it("authenticates every route before validation", async () => {
    for (const [method, url, payload] of [
      ["GET", base, undefined],
      ["GET", `${base}/${randomUUID()}`, undefined],
      ["POST", base, {}],
      ["PATCH", `${base}/${randomUUID()}`, {}],
      ["POST", `${base}/${randomUUID()}/archive`, {}]
    ] as const)
      expect(
        (await app.inject({ method, url, ...(payload ? { payload } : {}) }))
          .statusCode
      ).toBe(401);
    const user = await owner();
    expect(await db.account.count({ where: { userId: user.id } })).toBe(0);
  });

  it("creates user-defined accounts with permanent currency, exact signed baselines and no income", async () => {
    const user = await owner();
    const first = await create(user, {
      name: "  BMO\t Chequing  ",
      openingBalanceMinor: -12345
    });
    expect(first).toMatchObject({
      name: "BMO Chequing",
      type: "bank",
      currency: "CAD",
      openingBalanceMinor: -12345,
      archivedAt: null
    });
    expect(
      (await create(user, { name: "Cash", type: "cash" })).openingBalanceMinor
    ).toBe(0);
    expect(
      (await request(user, "GET", `${base}/${first.id}?asOf=2026-01-01`)).json()
    ).toMatchObject({ asOf: "2026-01-01", balanceMinor: -12345 });
    expect(
      (await request(user, "GET", `${base}/${first.id}?asOf=2025-12-31`)).json()
        .error.code
    ).toBe("INVALID_ACCOUNT");
    expect((await preferences.get(user.id)).entryCurrency).toBe("CAD");
    expect(await db.transaction.count({ where: { userId: user.id } })).toBe(0);
    expect(
      await createDashboardService(db).summary(user.id, {
        from: "2026-01-01",
        to: "2026-01-31",
        currency: "CAD",
        recentLimit: 5
      })
    ).toMatchObject({ incomeMinor: 0, expensesMinor: 0, netMinor: 0 });
    expect(
      (
        await request(
          user,
          "POST",
          base,
          input({ currency: "USD", name: "Stale" })
        )
      ).json().error.code
    ).toBe("PREFERENCE_CHANGED");
    await expect(
      preferences.update(user.id, { entryCurrency: "USD" })
    ).rejects.toMatchObject({ code: "CURRENCY_LOCKED" });
    const usdOwner = await owner("USD");
    expect(
      (await create(usdOwner, { name: "New USD", currency: "USD" })).currency
    ).toBe("USD");
    expect((await accounts.get(user.id, first.id)).currency).toBe("CAD");
  });

  it("validates strict HTTP bodies/queries and exposes generated OpenAPI", async () => {
    const user = await owner();
    const account = await create(user);
    for (const extra of [
      { userId: randomUUID() },
      { name: "\u200b" },
      { openingBalanceMinor: "100" },
      { openingBalanceMinor: 1.2 },
      { openingDate: "2026-02-29" }
    ])
      expect((await request(user, "POST", base, input(extra))).statusCode).toBe(
        422
      );
    for (const patch of [
      {},
      { currency: "USD" },
      { openingDate: "2026-01-02" },
      { openingBalanceMinor: 0 },
      { archivedAt: null }
    ])
      expect(
        (await request(user, "PATCH", `${base}/${account.id}`, patch))
          .statusCode
      ).toBe(422);
    for (const suffix of [
      "?limit=101",
      "?status=bad",
      "?after=bad",
      "?userId=forged"
    ])
      expect((await request(user, "GET", `${base}${suffix}`)).statusCode).toBe(
        422
      );
    expect(
      (
        await request(user, "POST", `${base}/${account.id}/archive`, {
          userId: user.id
        })
      ).statusCode
    ).toBe(422);
    expect(
      (await request(user, "DELETE", `${base}/${account.id}`)).statusCode
    ).toBe(404);
    const schema = app.swagger();
    expect(schema.paths?.[base]?.post).toHaveProperty("requestBody");
    expect(
      schema.paths?.[`${base}/{id}`]?.get?.responses?.["200"]
    ).toBeDefined();
  });

  it("enforces normalized active names per owner, including concurrent creates and renames", async () => {
    const user = await owner(),
      other = await owner();
    const account = await create(user, { name: "My Cash" });
    const duplicate = await request(
      user,
      "POST",
      base,
      input({ name: " my\t CASH " })
    );
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe("ACCOUNT_NAME_CONFLICT");
    await create(other, { name: "My Cash" });
    const results = await Promise.all([
      request(user, "POST", base, input({ name: "Concurrent" })),
      request(user, "POST", base, input({ name: " concurrent " }))
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    const another = await create(user, { name: "Other" });
    expect(
      (
        await request(user, "PATCH", `${base}/${another.id}`, {
          name: "MY CASH"
        })
      ).json().error.code
    ).toBe("ACCOUNT_NAME_CONFLICT");
    const renamed = await request(user, "PATCH", `${base}/${another.id}`, {
      name: " My\t Savings ",
      type: "other"
    });
    expect(renamed.json()).toMatchObject({ name: "My Savings", type: "other" });
    const renames = await Promise.all([
      request(user, "PATCH", `${base}/${another.id}`, {
        name: "Shared target"
      }),
      request(user, "PATCH", `${base}/${account.id}`, { name: "SHARED TARGET" })
    ]);
    expect(renames.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    // Deliberately ASCII-only folding, independent of database locale.
    await create(user, { name: "\u00c9" });
    await create(user, { name: "\u00e9" });
  });

  it("isolates bounded pages, all resource operations, and default selection by verified owner", async () => {
    const user = await owner(),
      other = await owner();
    const ids = [
      (await create(user)).id,
      (await create(user, { name: "Second" })).id
    ];
    const foreign = await create(other);
    const first = (await request(user, "GET", `${base}?limit=1`)).json();
    const second = (
      await request(user, "GET", `${base}?limit=1&after=${first.nextCursor}`)
    ).json();
    expect(
      [...first.items, ...second.items].map((a: { id: string }) => a.id).sort()
    ).toEqual(ids.sort());
    expect(second.nextCursor).toBeNull();
    for (const id of [foreign.id, randomUUID()]) {
      for (const [method, suffix, payload] of [
        ["GET", "", undefined],
        ["PATCH", "", { name: "Forged" }],
        ["POST", "/archive", {}]
      ] as const) {
        const result = await request(
          user,
          method,
          `${base}/${id}${suffix}`,
          payload
        );
        expect(result.statusCode).toBe(404);
        expect(result.json().error.code).toBe("NOT_FOUND");
        expect(result.body).not.toContain(other.id);
      }
      expect(
        (
          await request(user, "PATCH", "/v1/preferences", {
            defaultAccountId: id
          })
        ).statusCode
      ).toBe(404);
    }
  });

  it("persists explicit defaults, clears archived defaults and preserves historical account information", async () => {
    const user = await owner();
    const account = await create(user, { openingBalanceMinor: 1000 });
    expect(
      (
        await request(user, "PATCH", "/v1/preferences", {
          defaultAccountId: account.id
        })
      ).json().defaultAccountId
    ).toBe(account.id);
    expect(
      (await createPreferencesService(db).get(user.id)).defaultAccountId
    ).toBe(account.id);
    expect(
      (
        await request(user, "PATCH", "/v1/preferences", {
          defaultAccountId: null
        })
      ).json().defaultAccountId
    ).toBeNull();
    await preferences.update(user.id, { defaultAccountId: account.id });
    await expect(
      preferences.update(user.id, { entryCurrency: "USD" })
    ).rejects.toMatchObject({ code: "CURRENCY_LOCKED" });
    expect((await preferences.get(user.id)).defaultAccountId).toBe(account.id);
    const archived = await request(
      user,
      "POST",
      `${base}/${account.id}/archive`,
      {}
    );
    expect(archived.json().archivedAt).not.toBeNull();
    expect(
      (await request(user, "POST", `${base}/${account.id}/archive`, {})).json()
    ).toEqual(archived.json());
    expect((await preferences.get(user.id)).defaultAccountId).toBeNull();
    expect(
      (await request(user, "GET", `${base}/${account.id}`)).json()
    ).toMatchObject({
      currency: "CAD",
      openingBalanceMinor: 1000,
      balanceMinor: 1000
    });
    expect(
      (
        await request(user, "PATCH", `${base}/${account.id}`, {
          name: "No edit"
        })
      ).json().error.code
    ).toBe("ACCOUNT_ARCHIVED");
    expect(
      (
        await request(user, "PATCH", "/v1/preferences", {
          defaultAccountId: account.id
        })
      ).json().error.code
    ).toBe("INVALID_ACCOUNT");
    expect((await request(user, "GET", base)).json().items).toHaveLength(0);
    expect(
      (await request(user, "GET", `${base}?status=archived`)).json().items
    ).toHaveLength(1);
    expect(
      (await request(user, "GET", `${base}?status=all`)).json().items
    ).toHaveLength(1);
    expect((await create(user)).id).not.toBe(account.id);
  });

  it("serializes archive/default races and keeps currency permanent during concurrent defaults/creates", async () => {
    const user = await owner();
    const account = await create(user);
    const [selection, archive] = await Promise.all([
      request(user, "PATCH", "/v1/preferences", {
        defaultAccountId: account.id
      }),
      request(user, "POST", `${base}/${account.id}/archive`, {})
    ]);
    expect([200, 422]).toContain(selection.statusCode);
    expect(archive.statusCode).toBe(200);
    expect((await preferences.get(user.id)).defaultAccountId).toBeNull();
    const active = await create(user, { name: "Active" });
    const [select, currency] = await Promise.all([
      request(user, "PATCH", "/v1/preferences", {
        defaultAccountId: active.id
      }),
      request(user, "PATCH", "/v1/preferences", { entryCurrency: "USD" })
    ]);
    expect(select.statusCode).toBe(200);
    expect(currency.statusCode).toBe(409);
    expect((await preferences.get(user.id)).defaultAccountId).toBe(active.id);
    const [createResult, change] = await Promise.all([
      request(
        user,
        "POST",
        base,
        input({ name: "Racing creation", currency: "USD" })
      ),
      request(user, "PATCH", "/v1/preferences", { entryCurrency: "EUR" })
    ]);
    expect(change.statusCode).toBe(409);
    expect(createResult.statusCode).toBe(409);
    expect(createResult.json().error.code).toBe("PREFERENCE_CHANGED");
    expect(await preferences.get(user.id)).toMatchObject({
      entryCurrency: "CAD",
      hasActiveAccounts: true,
      defaultAccountId: active.id
    });
  });

  it("enforces immutable baselines, owned eligible defaults, uniqueness and archive cleanup in direct DB writes too", async () => {
    const user = await owner(),
      other = await owner();
    const account = await create(user);
    const foreign = await create(other);
    for (const data of [
      { currency: "USD" },
      { openingBalanceMinor: 1 },
      { openingDate: new Date("2026-02-01T00:00:00Z") },
      { userId: other.id }
    ])
      await expect(
        db.account.update({ where: { id: account.id }, data })
      ).rejects.toThrow();
    await expect(
      db.account.create({
        data: {
          userId: user.id,
          name: " my BANK ",
          type: "cash",
          currency: "CAD",
          openingDate: new Date("2026-01-01T00:00:00Z")
        }
      })
    ).rejects.toThrow();
    await expect(
      db.financePreferences.update({
        where: { userId: user.id },
        data: { defaultAccountId: foreign.id }
      })
    ).rejects.toThrow();
    await db.financePreferences.update({
      where: { userId: user.id },
      data: { defaultAccountId: account.id }
    });
    await expect(
      db.financePreferences.update({
        where: { userId: user.id },
        data: { entryCurrency: "USD" }
      })
    ).rejects.toThrow();
    expect((await preferences.get(user.id)).defaultAccountId).toBe(account.id);
    await db.financePreferences.update({
      where: { userId: user.id },
      data: { entryCurrency: "CAD", defaultAccountId: account.id }
    });
    await db.account.update({
      where: { id: account.id },
      data: { archivedAt: new Date() }
    });
    expect((await preferences.get(user.id)).defaultAccountId).toBeNull();
    await expect(
      db.financePreferences.update({
        where: { userId: user.id },
        data: { defaultAccountId: account.id }
      })
    ).rejects.toThrow();
    await expect(
      db.account.update({
        where: { id: account.id },
        data: { archivedAt: null }
      })
    ).rejects.toThrow();
  });
});
