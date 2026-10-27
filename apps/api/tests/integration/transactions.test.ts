import { randomUUID } from "node:crypto";
import { Writable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { createAuthService } from "../../src/auth/service.js";
import { createTransactionService } from "../../src/transactions/service.js";
import { testConfig } from "../fixtures.js";
import { disposableDatabase } from "../support/disposable.js";

const database = disposableDatabase();
const db = database.db;
let app: Awaited<ReturnType<typeof buildApp>>;
let alice: { token: string; id: string; categoryId: string };
let bob: typeof alice;
const root = "/v1/transactions";
const logs: string[] = [];
beforeAll(async () => {
  await database.start();
  const auth = await createAuthService(db, testConfig(), async () => {
    throw new Error("No provider");
  });
  app = await buildApp(testConfig(), auth, {
    logger: {
      level: "info",
      stream: new Writable({
        write(chunk, _encoding, callback) {
          logs.push(String(chunk));
          callback();
        }
      })
    },
    rateLimitMax: 10000,
    transactions: createTransactionService(db)
  });
  async function owner() {
    const email = `${randomUUID()}@example.invalid`;
    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { email, password: "synthetic transaction password" }
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
const input = () => ({
  direction: "expense",
  amountMinor: 101,
  currency: "USD",
  date: "2024-02-29",
  categoryId: alice.categoryId,
  merchant: "Synthetic shop",
  note: "Keep this note"
});
function request(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path = root,
  payload?: object,
  token = alice.token
) {
  return app.inject({
    method,
    url: path,
    headers: { authorization: `Bearer ${token}` },
    ...(payload ? { payload } : {})
  });
}
async function create(extra: object = {}) {
  const response = await request("POST", root, { ...input(), ...extra });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ id: string; note: string }>();
}
describe("protected transactions", () => {
  it("requires authentication on all operations", async () => {
    for (const [method, url] of [
      ["GET", root],
      ["GET", `${root}/${randomUUID()}`],
      ["POST", root],
      ["PATCH", `${root}/${randomUUID()}`],
      ["DELETE", `${root}/${randomUUID()}`]
    ] as const) {
      expect((await app.inject({ method, url })).statusCode).toBe(401);
      expect((await request(method, url, undefined, "forged")).statusCode).toBe(
        401
      );
    }
  });
  it("round trips exact bounds and real dates, patches without clearing omitted fields, deletes", async () => {
    for (const currency of ["USD", "EUR", "GBP", "INR", "JPY", "KWD"]) {
      const row = await create({ currency, amountMinor: 2147483647 });
      expect((await request("GET", `${root}/${row.id}`)).json()).toMatchObject({
        amountMinor: 2147483647,
        date: "2024-02-29",
        currency
      });
      expect(
        (
          await request("PATCH", `${root}/${row.id}`, {
            amountMinor: 1,
            date: "0001-01-01"
          })
        ).json()
      ).toMatchObject({
        amountMinor: 1,
        date: "0001-01-01",
        note: "Keep this note"
      });
      expect(
        (await request("PATCH", `${root}/${row.id}`, { note: null })).json()
          .note
      ).toBeNull();
      expect((await request("DELETE", `${root}/${row.id}`)).json()).toEqual({
        ok: true
      });
      expect((await request("GET", `${root}/${row.id}`)).statusCode).toBe(404);
    }
  });
  it("rejects malformed amounts, currencies, dates, text, category assignments and owner/import injection", async () => {
    const row = await create();
    for (const patch of [
      { amountMinor: 0 },
      { amountMinor: -1 },
      { amountMinor: 1.1 },
      { amountMinor: 2147483648 },
      { amountMinor: "100" },
      { currency: "ZZZ" },
      { currency: "usd" },
      { date: "2023-02-29" },
      { date: "2024-04-31" },
      { date: "0000-01-01" },
      { date: "2024-01-01T00:00:00Z" },
      { merchant: " " },
      { merchant: "x".repeat(201) },
      { note: "x".repeat(2001) },
      { note: "bad\u0000text" },
      { merchant: "\ud800" },
      { categoryId: bob.categoryId },
      { categoryId: randomUUID() },
      { userId: bob.id },
      { importId: randomUUID() }
    ]) {
      for (const [method, path, payload] of [
        ["POST", root, { ...input(), ...patch }],
        ["PATCH", `${root}/${row.id}`, patch]
      ] as const)
        expect(
          (await request(method, path, payload)).statusCode,
          JSON.stringify(patch)
        ).toBe(422);
    }
    expect((await request("PATCH", `${root}/${row.id}`, {})).statusCode).toBe(
      422
    );
    expect(
      (await request("GET", `${root}/${row.id}`)).json()
    ).not.toHaveProperty("userId");
    expect((await request("GET", `${root}/${row.id}`)).json()).toMatchObject(
      input()
    );
  });
  it("hides foreign/missing IDs equally and isolates list and writes", async () => {
    const other = await request(
      "POST",
      root,
      { ...input(), categoryId: bob.categoryId },
      bob.token
    );
    expect(other.statusCode).toBe(201);
    for (const id of [other.json().id as string, randomUUID()])
      for (const method of ["GET", "PATCH", "DELETE"] as const) {
        const result = await request(
          method,
          `${root}/${id}`,
          method === "PATCH" ? { merchant: "Intruder" } : undefined
        );
        expect(result.statusCode).toBe(404);
        expect(result.json().error).toMatchObject({
          code: "NOT_FOUND",
          message: "Resource not found."
        });
      }
    expect(
      (await request("GET", `${root}?categoryId=${bob.categoryId}`)).json()
        .items
    ).toEqual([]);
    expect(
      (
        await request("GET", `${root}/${other.json().id}`, undefined, bob.token)
      ).json().merchant
    ).toBe("Synthetic shop");
  });
  it("preserves archived history but rejects new assignments", async () => {
    const category = await db.category.create({
      data: { userId: alice.id, name: "Historical" }
    });
    const row = await create({ categoryId: category.id });
    await db.category.update({
      where: { id: category.id },
      data: { archivedAt: new Date() }
    });
    expect(
      (
        await request("PATCH", `${root}/${row.id}`, {
          categoryId: category.id,
          merchant: "Edited history"
        })
      ).statusCode
    ).toBe(200);
    expect(
      (await request("POST", root, { ...input(), categoryId: category.id }))
        .statusCode
    ).toBe(422);
    const other = await create();
    expect(
      (
        await request("PATCH", `${root}/${other.id}`, {
          categoryId: category.id
        })
      ).statusCode
    ).toBe(422);
    expect(
      (await request("GET", `${root}?categoryId=${category.id}`)).json()
        .items[0].id
    ).toBe(row.id);
  });
  it("combines inclusive filters and paginates same-day ties without duplicates, including after deletion", async () => {
    const category = await db.category.create({
      data: { userId: alice.id, name: "Filter" }
    });
    const expected: string[] = [];
    for (const date of [
      "2026-10-01",
      "2026-10-02",
      "2026-10-02",
      "2026-10-03"
    ]) {
      const row = await create({
        categoryId: category.id,
        date,
        direction: "income"
      });
      if (date !== "2026-10-03") expected.push(row.id);
    }
    await create({
      categoryId: category.id,
      date: "2026-10-02",
      direction: "expense"
    });
    const query = `from=2026-10-01&to=2026-10-02&categoryId=${category.id}&direction=income&limit=1`;
    const ids: string[] = [];
    let after: string | null = null;
    do {
      const result = await request(
        "GET",
        `${root}?${query}${after ? `&after=${after}` : ""}`
      );
      expect(result.statusCode).toBe(200);
      const page = result.json<{
        items: { id: string }[];
        nextCursor: string | null;
      }>();
      ids.push(...page.items.map((row) => row.id));
      after = page.nextCursor;
      if (ids.length === 1) await request("DELETE", `${root}/${ids[0]}`);
    } while (after);
    expect(ids.sort()).toEqual(expected.sort());
    expect(new Set(ids).size).toBe(ids.length);
    for (const query of [
      "limit=0",
      "limit=101",
      "limit=1.5",
      "after=bad",
      "from=2026-01-01",
      "to=2026-01-01",
      "from=2026-02-01&to=2026-01-01",
      "from=2020-01-01&to=2026-01-01",
      "direction=transfer",
      "userId=bad"
    ])
      expect((await request("GET", `${root}?${query}`)).statusCode).toBe(422);
  });
  it("publishes protected routes and supports DELETE preflight", async () => {
    await app.ready();
    const spec = app.swagger();
    for (const method of ["get", "post"] as const)
      expect(spec.paths?.[root]?.[method]?.security).toEqual([
        { bearerAuth: [] }
      ]);
    for (const method of ["get", "patch", "delete"] as const)
      expect(spec.paths?.[`${root}/{id}`]?.[method]?.security).toEqual([
        { bearerAuth: [] }
      ]);
    const response = await app.inject({
      method: "OPTIONS",
      url: root,
      headers: {
        origin: "https://app.example.invalid",
        "access-control-request-method": "DELETE"
      }
    });
    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-methods"]).toContain(
      "DELETE"
    );
  });
  it("keeps transaction bodies, filters, IDs and credentials out of routine logs", async () => {
    const row = await create({
      merchant: "private-merchant-marker",
      note: "private-note-marker"
    });
    await request(
      "GET",
      `${root}?categoryId=${alice.categoryId}&from=2024-02-29&to=2024-02-29`
    );
    const output = logs.join("");
    expect(output).toContain("request completed");
    for (const value of [
      "private-merchant-marker",
      "private-note-marker",
      row.id,
      alice.categoryId,
      alice.token,
      "2024-02-29"
    ])
      expect(output).not.toContain(value);
  });
});
