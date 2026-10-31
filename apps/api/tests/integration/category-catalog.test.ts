import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAuthService } from "../../src/auth/service.js";
import { defaultCategoryCatalog } from "../../src/categories/catalog.v1.js";
import {
  backfillCategoryCatalog,
  CategoryCatalogConflict,
  planCategoryCatalog,
  provisionCategoryCatalog
} from "../../src/categories/provision.js";
import { testConfig } from "../fixtures.js";
import { disposableDatabase } from "../support/disposable.js";

const database = disposableDatabase();
const db = database.db;
let auth: Awaited<ReturnType<typeof createAuthService>>;
const password = "synthetic catalog passphrase";
async function owner() {
  return db.user.create({ data: { email: `${randomUUID()}@example.invalid` } });
}
beforeAll(async () => {
  await database.start();
  auth = await createAuthService(
    db,
    { ...testConfig(), categoryHierarchyEnabled: true },
    async (subject) => ({
      subject,
      email: `${subject}@example.invalid`,
      verifiedEmail: true
    })
  );
});
afterAll(async () => {
  await database.close();
});

describe("user-confirmed default category catalog", () => {
  it("upgrades fixed icons without rewriting history and restores immutability", async () => {
    const user = await owner();
    const plan = planCategoryCatalog([], user.id);
    await db.category.createMany({
      data: plan.data.map((row) => ({ ...row, iconKey: "category" }))
    });
    const before = await db.category.findMany({
      where: { userId: user.id },
      orderBy: { id: "asc" }
    });
    const sql = new pg.Client({ connectionString: database.url });
    await sql.connect();
    try {
      const migration = await readFile(
        new URL(
          "../../prisma/migrations/20261030040000_category_icons/migration.sql",
          import.meta.url
        ),
        "utf8"
      );
      await sql.query(migration);
      await sql.query(migration);
      const after = await db.category.findMany({
        where: { userId: user.id },
        orderBy: { id: "asc" }
      });
      expect(after).toEqual(
        before.map((row) => ({
          ...row,
          iconKey: defaultCategoryCatalog.items.find(
            (item) => item.key === row.defaultKey
          )!.iconKey
        }))
      );
      await expect(
        sql.query('UPDATE "Category" SET "iconKey" = $1 WHERE id = $2', [
          "category",
          after[0]!.id
        ])
      ).rejects.toMatchObject({ code: "23514" });
    } finally {
      await sql.end();
    }
  });
  it("provisions password/Google signup once and never duplicates on login or linking", async () => {
    const email = `${randomUUID()}@example.invalid`;
    const tokens = await auth.register(email, password);
    const principal = await auth.authenticate(tokens.accessToken);
    const rows = await db.category.findMany({
      where: { userId: principal.userId }
    });
    expect(rows).toHaveLength(80);
    expect(rows.filter((row) => row.parentId === null)).toHaveLength(10);
    expect(rows.every((row) => row.isDefault && row.defaultKey)).toBe(true);
    for (const row of rows)
      expect(row.iconKey).toBe(
        defaultCategoryCatalog.items.find((item) => item.key === row.defaultKey)
          ?.iconKey
      );
    expect(new Set(rows.map((row) => row.defaultKey)).size).toBe(
      defaultCategoryCatalog.items.length
    );
    expect(rows.filter((row) => row.name === "Child Support")).toHaveLength(2);
    await auth.login(email, password);
    const subject = randomUUID();
    const challenge = await auth.challenge("login");
    const googleTokens = await auth.googleLogin({
      challengeId: challenge.challengeId,
      nonce: challenge.nonce,
      idToken: subject
    });
    const googlePrincipal = await auth.authenticate(googleTokens.accessToken);
    const again = await auth.challenge("login");
    await auth.googleLogin({
      challengeId: again.challengeId,
      nonce: again.nonce,
      idToken: subject
    });
    const link = await auth.challenge("link", principal);
    await auth.link(principal, {
      challengeId: link.challengeId,
      nonce: link.nonce,
      idToken: randomUUID()
    });
    expect(
      await db.category.count({ where: { userId: principal.userId } })
    ).toBe(80);
    const other = await db.category.findMany({
      where: { userId: googlePrincipal.userId }
    });
    expect(other).toHaveLength(80);
    expect(
      other.some((row) => rows.some((original) => original.id === row.id))
    ).toBe(false);
  });
  it("serializes concurrent reruns and supports read-only preview and bounded paging", async () => {
    const user = await owner();
    const preview = await db.$transaction((tx) =>
      provisionCategoryCatalog(tx, user.id, false)
    );
    expect(preview).toMatchObject({ created: 0, pending: 80 });
    expect(await db.category.count({ where: { userId: user.id } })).toBe(0);
    const results = await Promise.all([
      db.$transaction((tx) => provisionCategoryCatalog(tx, user.id)),
      db.$transaction((tx) => provisionCategoryCatalog(tx, user.id))
    ]);
    expect(
      results.map((result) => result.created).sort((a, b) => a - b)
    ).toEqual([0, 80]);
    const page = await backfillCategoryCatalog(db, { limit: 1, apply: false });
    expect(page.results).toHaveLength(1);
    expect(page.nextCursor).not.toBeNull();
    const next = await backfillCategoryCatalog(db, {
      limit: 1,
      after: page.nextCursor!,
      apply: false
    });
    expect(next.results[0]!.userId).not.toBe(page.results[0]!.userId);
  });
  it("reports normalized personal-name collisions and writes no partial catalog", async () => {
    const user = await owner();
    const personal = await db.category.create({
      data: { userId: user.id, name: " \tFOOD & Drinks " }
    });
    await expect(
      db.$transaction((tx) => provisionCategoryCatalog(tx, user.id))
    ).rejects.toMatchObject({
      conflicts: [
        {
          catalogKey: "food-drinks",
          categoryId: personal.id,
          reason: "active-name"
        }
      ]
    });
    expect(await db.category.findMany({ where: { userId: user.id } })).toEqual([
      personal
    ]);
  });
  it("preserves archived legacy IDs and already-keyed historical labels/archives", async () => {
    const user = await owner();
    const legacy = await db.category.create({
      data: {
        userId: user.id,
        name: "Income",
        archivedAt: new Date("2026-01-01")
      }
    });
    const plan = planCategoryCatalog([legacy], user.id);
    const archivedAt = new Date("2026-01-02");
    await db.category.createMany({
      data: plan.data.map((row) => ({
        ...row,
        ...(row.defaultKey === "shopping"
          ? { name: "Historical shopping label" }
          : {}),
        ...(row.defaultKey?.startsWith("shopping") ? { archivedAt } : {})
      }))
    });
    expect(
      (await db.$transaction((tx) => provisionCategoryCatalog(tx, user.id)))
        .created
    ).toBe(0);
    expect(await db.category.findUnique({ where: { id: legacy.id } })).toEqual(
      legacy
    );
    expect(
      await db.category.findUnique({
        where: {
          userId_defaultKey: { userId: user.id, defaultKey: "shopping" }
        }
      })
    ).toMatchObject({ name: "Historical shopping label", archivedAt });
  });
  it("rolls the tree back with its transaction and refuses missing children of archived roots", async () => {
    const email = `${randomUUID()}@example.invalid`;
    await expect(
      db.$transaction(async (tx) => {
        const user = await tx.user.create({ data: { email } });
        await provisionCategoryCatalog(tx, user.id);
        throw new Error("Synthetic later failure");
      })
    ).rejects.toThrow("Synthetic later failure");
    expect(await db.user.findUnique({ where: { email } })).toBeNull();
    const user = await owner();
    const root = await db.category.create({
      data: {
        userId: user.id,
        name: "Old fixed root",
        isDefault: true,
        defaultKey: "food-drinks",
        archivedAt: new Date("2026-01-01")
      }
    });
    await expect(
      db.$transaction((tx) => provisionCategoryCatalog(tx, user.id))
    ).rejects.toBeInstanceOf(CategoryCatalogConflict);
    expect(await db.category.findMany({ where: { userId: user.id } })).toEqual([
      root
    ]);
  });
});
