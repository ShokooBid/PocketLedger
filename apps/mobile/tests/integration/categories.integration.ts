// Runs the actual portable mobile client against Fastify and real disposable
// PostgreSQL. Only OS storage and the HTTP socket are replaced, not auth/routes.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../../api/src/app.js";
import { createAuthService } from "../../../api/src/auth/service.js";
import { createCategoryService } from "../../../api/src/categories/service.js";
import { createTransactionService } from "../../../api/src/transactions/service.js";
import { createApiTransactionSource } from "../../src/transaction-api";
import {
  draftInput,
  currencyExponents,
  type Currency
} from "../../src/transaction-data";
import { testConfig } from "../../../api/tests/fixtures.js";
import { disposableDatabase } from "../../../api/tests/support/disposable.js";
import { createSessionController } from "../../src/auth/session-controller";
import { createTransport, type FetchRequest } from "../../src/auth/transport";
import { createApiCategorySource } from "../../src/category-api";
import type { CredentialStore, StoredSession } from "../../src/auth/contracts";

const database = disposableDatabase();
const db = database.db;
let app: Awaited<ReturnType<typeof buildApp>>;
let clock = Date.now();
const config = { ...testConfig(), accessSeconds: 60 };
const requests: string[] = [];
const fetcher: FetchRequest = async (input, options) => {
  const url = new URL(String(input));
  requests.push(`${options?.method ?? "GET"} ${url.pathname}`);
  const headers = Object.fromEntries(new Headers(options?.headers).entries());
  const result = await app.inject({
    method: (options?.method ?? "GET") as "GET" | "POST" | "PATCH" | "DELETE",
    url: url.pathname + url.search,
    headers,
    ...(typeof options?.body === "string" ? { payload: options.body } : {})
  });
  return new Response(result.body, { status: result.statusCode });
};
function device() {
  let disk: StoredSession | null = null;
  const store: CredentialStore = {
    read: async () => disk,
    write: async (value) => {
      disk = value;
    },
    clear: async () => {
      disk = null;
    }
  };
  const make = () =>
    createSessionController(
      store,
      createTransport("https://api.example.invalid", fetcher),
      async () => null,
      () => clock
    );
  const controller = make();
  const source = (session = controller) => {
    const state = session.getSnapshot();
    if (state.status !== "authenticated")
      throw new Error("Test requires verified session.");
    return createApiCategorySource(session.client(state.generation));
  };
  return { controller, restart: make, source, disk: () => disk };
}
beforeAll(async () => {
  await database.start();
  const auth = await createAuthService(
    db,
    config,
    async () => {
      throw new Error("No live provider.");
    },
    () => new Date(clock)
  );
  app = await buildApp(config, auth, {
    logger: false,
    rateLimitMax: 10000,
    categories: createCategoryService(db),
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

describe("authenticated mobile category flow", () => {
  it("submits exact mobile amounts, filters, edits and deletes through verified sessions", async () => {
    const d = device();
    await d.controller.restore();
    await d.controller.signIn(
      "register",
      `${randomUUID()}@example.invalid`,
      "synthetic mobile passphrase"
    );
    await d.source().create("Transaction category");
    const category = (await d.source().list())[0]!;
    const state = d.controller.getSnapshot();
    if (state.status !== "authenticated") throw new Error("No session");
    const source = createApiTransactionSource(
      d.controller.client(state.generation)
    );
    for (const currency of Object.keys(currencyExponents) as Currency[]) {
      const exponent = currencyExponents[currency];
      const input = draftInput({
        direction: "expense",
        amount: exponent ? `1.${"0".repeat(exponent - 1)}1` : "1",
        currency,
        date: "2024-02-29",
        categoryId: category.id,
        merchant: "Synthetic client shop",
        note: ""
      });
      const row = await source.create(input);
      expect(row.amountMinor).toBe(
        exponent === 3 ? 1001 : exponent === 2 ? 101 : 1
      );
      expect(
        (await db.transaction.findUniqueOrThrow({ where: { id: row.id } }))
          .amountMinor
      ).toBe(row.amountMinor);
      expect(
        (
          await source.list({
            from: "2024-02-29",
            to: "2024-02-29",
            direction: "expense",
            categoryId: category.id
          })
        ).items.some((item) => item.id === row.id)
      ).toBe(true);
      expect(
        (await source.update(row.id, { ...input, amountMinor: 2 })).amountMinor
      ).toBe(2);
      await source.remove(row.id);
    }
    expect((await source.list({})).items).toEqual([]);
    await d.controller.logout();
    await expect(source.list({})).rejects.toMatchObject({ kind: "cancelled" });
  });
  it("creates, validates, paginates, renames and archives while preserving history", async () => {
    const d = device();
    await d.controller.restore();
    await d.controller.signIn(
      "register",
      `${randomUUID()}@example.invalid`,
      "synthetic mobile passphrase"
    );
    const source = d.source();
    await source.create("  Daily\tfood ");
    const original = (await source.list())[0]!;
    expect(original.name).toBe("Daily food");
    await expect(source.create("daily FOOD")).rejects.toMatchObject({
      code: "duplicate"
    });
    await expect(source.rename(original.id, " ")).rejects.toMatchObject({
      code: "validation"
    });
    await source.rename(original.id, "Groceries");
    const user = d.controller.getSnapshot();
    if (user.status !== "authenticated") throw new Error("Test lost session.");
    const tx = await db.transaction.create({
      data: {
        userId: user.user.id,
        categoryId: original.id,
        direction: "expense",
        amountMinor: 100,
        currency: "USD",
        date: new Date("2026-01-01"),
        merchant: "Synthetic shop"
      }
    });
    await source.archive(original.id);
    expect((await source.list())[0]?.archivedAt).not.toBeNull();
    await source.create("GROCERIES");
    const history = await db.transaction.findUniqueOrThrow({
      where: { id: tx.id },
      include: { category: true }
    });
    expect(history.category.id).toBe(original.id);
    expect(history.category.archivedAt).not.toBeNull();
    await db.category.createMany({
      data: Array.from({ length: 102 }, (_, n) => ({
        userId: user.user.id,
        name: `Synthetic page ${n}`
      }))
    });
    const pages = requests.length;
    expect(await source.list()).toHaveLength(104);
    expect(requests.slice(pages)).toEqual([
      "GET /v1/categories",
      "GET /v1/categories"
    ]);
  });
  it("restores, refreshes parallel reads once, rejects revocation and isolates accounts", async () => {
    const d = device();
    await d.controller.restore();
    const aliceEmail = `${randomUUID()}@example.invalid`;
    await d.controller.signIn(
      "register",
      aliceEmail,
      "synthetic mobile passphrase"
    );
    await d.source().create("Alice private category");
    const aliceId = (await d.source().list())[0]!.id;
    const restored = d.restart();
    await restored.restore();
    expect(restored.getSnapshot().status).toBe("authenticated");
    const source = d.source(restored);
    clock += 61000;
    const start = requests.length;
    await Promise.all([source.list(), source.list(), source.list()]);
    expect(
      requests.slice(start).filter((path) => path === "POST /v1/auth/refresh")
    ).toHaveLength(1);
    const aliceState = restored.getSnapshot();
    if (aliceState.status !== "authenticated")
      throw new Error("Test lost session.");
    await db.session.updateMany({
      where: { userId: aliceState.user.id },
      data: { revokedAt: new Date(clock) }
    });
    await expect(source.list()).rejects.toBeDefined();
    expect(restored.getSnapshot().status).toBe("signed-out");
    expect(d.disk()).toBeNull();
    await restored.signIn(
      "register",
      `${randomUUID()}@example.invalid`,
      "synthetic mobile passphrase"
    );
    const bobSource = d.source(restored);
    expect(await bobSource.list()).toEqual([]);
    await expect(bobSource.rename(aliceId, "Intrusion")).rejects.toMatchObject({
      code: "unavailable"
    });
    await expect(bobSource.archive(aliceId)).rejects.toMatchObject({
      code: "unavailable"
    });
    await bobSource.create("Bob category");
    const bobState = restored.getSnapshot();
    if (bobState.status !== "authenticated")
      throw new Error("Test lost session.");
    await restored.logout();
    expect(d.disk()).toBeNull();
    expect(
      await db.session.count({
        where: { userId: bobState.user.id, revokedAt: null }
      })
    ).toBe(0);
    await expect(bobSource.list()).rejects.toMatchObject({ kind: "cancelled" });
    await restored.signIn("login", aliceEmail, "synthetic mobile passphrase");
    expect((await d.source(restored).list()).map((row) => row.name)).toEqual([
      "Alice private category"
    ]);
  });
});
