import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { buildApp } from "../../src/app.js";
import { createAuthService } from "../../src/auth/service.js";
import { createCategoryService } from "../../src/categories/service.js";
import { createHierarchyCategoryService } from "../../src/categories/hierarchy-service.js";
import { createTransactionService } from "../../src/transactions/service.js";
import { createDashboardService } from "../../src/dashboard/service.js";
import { hierarchyCategoryQuery } from "../../src/categories/contracts.js";
import {
  hierarchyTransactionQuery,
  transactionQuery
} from "../../src/transactions/contracts.js";
import { testConfig } from "../fixtures.js";
import { disposableDatabase } from "../support/disposable.js";

const database = disposableDatabase();
const db = database.db;
const categories = createHierarchyCategoryService(db, true);
const transactions = createTransactionService(db);
const config = testConfig();
let app: Awaited<ReturnType<typeof buildApp>>;
let alice: { id: string; token: string };
let bob: typeof alice;
const base = "/v2/categories";
const headers = () => ({ authorization: `Bearer ${alice.token}` });
async function create(name: string, parentId?: string) {
  return categories.create(alice.id, {
    name,
    ...(parentId ? { parentId } : {})
  });
}
function posting(categoryId: string, amountMinor = 100) {
  return transactions.create(alice.id, {
    categoryId,
    amountMinor,
    currency: "CAD",
    direction: "expense",
    date: "2026-10-30",
    merchant: "Synthetic",
    note: null
  });
}
beforeAll(async () => {
  await database.start();
  const auth = await createAuthService(db, config, async () => {
    throw new Error("No provider calls.");
  });
  app = await buildApp(config, auth, {
    logger: false,
    rateLimitMax: 10000,
    categories: createCategoryService(db),
    hierarchyCategories: categories
  });
  async function owner() {
    const email = `${randomUUID()}@example.invalid`;
    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { email, password: "synthetic hierarchy passphrase" }
    });
    expect(response.statusCode, response.body).toBe(201);
    return {
      id: (await db.user.findUniqueOrThrow({ where: { email } })).id,
      token: response.json().accessToken as string
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

describe("two-level owned category hierarchy", () => {
  it("authenticates all routes before validation and keeps rollout disabled by default", async () => {
    for (const [method, url, payload] of [
      ["GET", base, undefined],
      ["GET", `${base}/recent`, undefined],
      ["GET", `${base}/${randomUUID()}`, undefined],
      ["POST", base, { name: "" }],
      ["PATCH", `${base}/${randomUUID()}`, {}],
      ["POST", `${base}/${randomUUID()}/archive`, {}]
    ] as const) {
      expect(
        (await app.inject({ method, url, ...(payload ? { payload } : {}) }))
          .statusCode
      ).toBe(401);
    }
    await expect(
      createHierarchyCategoryService(db).get(alice.id, randomUUID())
    ).rejects.toMatchObject({ code: "FINANCE_FEATURE_DISABLED" });
  });
  it("creates normalized personal roots/children with neutral metadata and rejects forged fields", async () => {
    const root = await app.inject({
      method: "POST",
      url: base,
      headers: headers(),
      payload: { name: "  Synthetic\t root  " }
    });
    expect(root.statusCode, root.body).toBe(201);
    expect(root.json()).toMatchObject({
      name: "Synthetic root",
      parentId: null,
      isDefault: false,
      defaultKey: null,
      iconKey: "category",
      colorKey: "neutral",
      sortOrder: 0
    });
    const parent = root.json().id as string;
    const child = await app.inject({
      method: "POST",
      url: base,
      headers: headers(),
      payload: { name: "Child", parentId: parent }
    });
    expect(child.statusCode, child.body).toBe(201);
    expect(child.json().parentId).toBe(parent);
    for (const extra of [
      { userId: bob.id },
      { isDefault: true },
      { defaultKey: "forged" },
      { archivedAt: null },
      { iconKey: "https://bad.invalid" },
      { sortOrder: -1 }
    ]) {
      expect(
        (
          await app.inject({
            method: "POST",
            url: base,
            headers: headers(),
            payload: { name: "Forged", ...extra }
          })
        ).statusCode
      ).toBe(422);
    }
    for (const name of [
      " ",
      "\u200b",
      "a".repeat(101),
      "a".repeat(1001),
      "bad\u0000text"
    ]) {
      expect(
        (
          await app.inject({
            method: "POST",
            url: base,
            headers: headers(),
            payload: { name }
          })
        ).statusCode
      ).toBe(422);
    }
  });
  it("scopes normalized uniqueness to active siblings with ASCII-only folding", async () => {
    const a = await create("Unique root A");
    const b = await create("Unique root B");
    await create("Same child", a.id);
    await create("Same child", b.id);
    await create("Same child");
    const conflict = await app.inject({
      method: "POST",
      url: base,
      headers: headers(),
      payload: { name: " same\tCHILD ", parentId: a.id }
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe("CATEGORY_NAME_CONFLICT");
    await create("É", a.id);
    await create("é", a.id);
    const other = await create("Other child", a.id);
    await expect(
      categories.update(alice.id, other.id, { name: "SAME CHILD" })
    ).rejects.toMatchObject({ code: "CATEGORY_NAME_CONFLICT" });
    await categories.archive(alice.id, other.id);
    expect((await create("Other child", a.id)).id).not.toBe(other.id);
  });
  it("rejects foreign/missing parents identically, child parents, and archived parents", async () => {
    const foreign = await categories.create(bob.id, { name: "Foreign root" });
    const errors = [];
    for (const parentId of [foreign.id, randomUUID()]) {
      const reply = await app.inject({
        method: "POST",
        url: base,
        headers: headers(),
        payload: { name: "No access", parentId }
      });
      expect(reply.statusCode).toBe(404);
      errors.push(reply.json().error.code);
    }
    expect(errors).toEqual(["NOT_FOUND", "NOT_FOUND"]);
    const root = await create("Depth root");
    const child = await create("Depth child", root.id);
    await expect(create("Grandchild", child.id)).rejects.toMatchObject({
      code: "INVALID_CATEGORY"
    });
    await categories.archive(alice.id, root.id);
    await expect(create("Inactive child", root.id)).rejects.toMatchObject({
      code: "INVALID_CATEGORY"
    });
    for (const id of [foreign.id, randomUUID()]) {
      await expect(categories.get(alice.id, id)).rejects.toMatchObject({
        code: "NOT_FOUND"
      });
      await expect(
        categories.update(alice.id, id, { name: "Private" })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(categories.archive(alice.id, id)).rejects.toMatchObject({
        code: "NOT_FOUND"
      });
    }
  });
  it("makes fixed roots and children immutable while allowing personal children", async () => {
    // Synthetic fixtures only: this is not the #67 catalog or a seed.
    const root = await db.category.create({
      data: {
        userId: alice.id,
        name: "Synthetic fixed root",
        isDefault: true,
        defaultKey: "test.root"
      }
    });
    const child = await db.category.create({
      data: {
        userId: alice.id,
        name: "Synthetic fixed child",
        isDefault: true,
        defaultKey: "test.child",
        parentId: root.id
      }
    });
    await create("Personal beneath fixed", root.id);
    for (const id of [root.id, child.id]) {
      for (const payload of [
        { name: "Rename" },
        { parentId: randomUUID() },
        { iconKey: "other" },
        { colorKey: "other" },
        { sortOrder: 20 }
      ]) {
        const reply = await app.inject({
          method: "PATCH",
          url: `${base}/${id}`,
          headers: headers(),
          payload
        });
        expect(reply.statusCode, reply.body).toBe(409);
        expect(reply.json().error.code).toBe("DEFAULT_CATEGORY_READ_ONLY");
      }
      await expect(categories.archive(alice.id, id)).rejects.toMatchObject({
        code: "DEFAULT_CATEGORY_READ_ONLY"
      });
    }
    const personal = await create("Immutable parent");
    await posting(personal.id);
    for (const payload of [
      { parentId: root.id },
      { isDefault: true },
      { defaultKey: "forged" },
      {}
    ]) {
      expect(
        (
          await app.inject({
            method: "PATCH",
            url: `${base}/${personal.id}`,
            headers: headers(),
            payload
          })
        ).statusCode
      ).toBe(422);
    }
    await expect(
      db.category.update({
        where: { id: personal.id },
        data: { parentId: root.id }
      })
    ).rejects.toThrow();
    expect((await categories.get(alice.id, personal.id)).parentId).toBeNull();
  });
  it("enforces hierarchy for direct SQL including self links and forward multi-row references", async () => {
    const sql = new pg.Client({ connectionString: database.url });
    await sql.connect();
    try {
      const self = randomUUID();
      await expect(
        sql.query(
          'INSERT INTO "Category" (id, "userId", name, "parentId") VALUES ($1, $2, $3, $1)',
          [self, alice.id, "Self"]
        )
      ).rejects.toMatchObject({ code: "23514" });
      const a = randomUUID(),
        b = randomUUID(),
        c = randomUUID();
      await expect(
        sql.query(
          "INSERT INTO \"Category\" (id, \"userId\", name, \"parentId\") VALUES ($1, $4, 'Forward child', $2), ($2, $4, 'Forward parent', $3), ($3, $4, 'Forward root', NULL)",
          [a, b, c, alice.id]
        )
      ).rejects.toMatchObject({ code: "23514" });
      const foreign = await categories.create(bob.id, { name: "SQL foreign" });
      await expect(
        sql.query(
          'INSERT INTO "Category" ("userId", name, "parentId") VALUES ($1, $2, $3)',
          [alice.id, "SQL leak", foreign.id]
        )
      ).rejects.toMatchObject({ code: "23503" });
      const fixed = await db.category.findFirstOrThrow({
        where: { userId: alice.id, isDefault: true }
      });
      await expect(
        sql.query('UPDATE "Category" SET name = $1 WHERE id = $2', [
          "SQL default edit",
          fixed.id
        ])
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        sql.query(
          'UPDATE "Category" SET "archivedAt" = CURRENT_TIMESTAMP WHERE id = $1',
          [fixed.id]
        )
      ).rejects.toMatchObject({ code: "23514" });
    } finally {
      await sql.end();
    }
  });
  it("archives active descendants atomically, preserves old timestamps/history, permits unchanged historical edits", async () => {
    const root = await create("Archive subtree");
    const first = await create("Active descendant", root.id);
    const old = await create("Old descendant", root.id);
    const rootPosting = await posting(root.id);
    const childPosting = await posting(first.id);
    const oldArchived = await categories.archive(alice.id, old.id);
    const archived = await categories.archive(alice.id, root.id);
    expect((await categories.get(alice.id, first.id)).archivedAt).toBe(
      archived.archivedAt
    );
    expect((await categories.get(alice.id, old.id)).archivedAt).toBe(
      oldArchived.archivedAt
    );
    expect(await categories.archive(alice.id, root.id)).toEqual(archived);
    for (const id of [root.id, first.id])
      await expect(posting(id)).rejects.toMatchObject({
        code: "INVALID_CATEGORY"
      });
    for (const saved of [rootPosting, childPosting])
      expect(
        (
          await transactions.update(alice.id, saved.id, {
            categoryId: saved.categoryId,
            note: "Historical edit"
          })
        ).categoryId
      ).toBe(saved.categoryId);
    const other = await create("Other active");
    const saved = await posting(other.id);
    await expect(
      transactions.update(alice.id, saved.id, { categoryId: first.id })
    ).rejects.toMatchObject({ code: "INVALID_CATEGORY" });
    await expect(
      categories.update(alice.id, first.id, { name: "Archived rename" })
    ).rejects.toMatchObject({ code: "CATEGORY_ARCHIVED" });
  });
  it("bounds list/search/recent, supplies paths, and isolates foreign filters", async () => {
    const root = await create("Search parent");
    const child = await create("Search match", root.id);
    await posting(root.id);
    await posting(child.id);
    await posting(child.id);
    const roots = await categories.list(
      alice.id,
      hierarchyCategoryQuery.parse({ parentId: "root" })
    );
    expect(roots.items.every((row) => row.parentId === null)).toBe(true);
    const children = await categories.list(
      alice.id,
      hierarchyCategoryQuery.parse({ parentId: root.id, q: "match" })
    );
    expect(children.items.map((row) => row.id)).toEqual([child.id]);
    const first = await categories.list(
      alice.id,
      hierarchyCategoryQuery.parse({ limit: 1, status: "all" })
    );
    const second = await categories.list(
      alice.id,
      hierarchyCategoryQuery.parse({
        limit: 1,
        status: "all",
        after: first.nextCursor
      })
    );
    expect(first.items[0]!.id).not.toBe(second.items[0]!.id);
    const recent = await app.inject({
      url: `${base}/recent?limit=2`,
      headers: headers()
    });
    expect(recent.statusCode, recent.body).toBe(200);
    expect(recent.json().items[0]).toMatchObject({
      id: child.id,
      parent: { id: root.id, name: root.name }
    });
    expect(
      new Set(recent.json().items.map((row: { id: string }) => row.id)).size
    ).toBe(recent.json().items.length);
    await categories.archive(alice.id, root.id);
    expect(
      (await categories.recent(alice.id, 20)).items.some(
        (row) => row.id === child.id
      )
    ).toBe(false);
    for (const query of [
      "limit=0",
      "limit=101",
      "q=" + "a".repeat(101),
      "parentId=invalid",
      "owner=forged"
    ])
      expect(
        (await app.inject({ url: `${base}?${query}`, headers: headers() }))
          .statusCode
      ).toBe(422);
    expect(
      (await app.inject({ url: `${base}/recent?limit=21`, headers: headers() }))
        .statusCode
    ).toBe(422);
  });
  it("preserves exact filters and separately rolls direct-root/child postings up once", async () => {
    const root = await create("Rollup root");
    const child = await create("Rollup child", root.id);
    const direct = await posting(root.id, 123);
    const nested = await posting(child.id, 456);
    const query = transactionQuery.parse({ categoryId: root.id });
    expect(
      (await transactions.list(alice.id, query)).items.map((row) => row.id)
    ).toEqual([direct.id]);
    expect(
      new Set(
        (
          await transactions.list(
            alice.id,
            hierarchyTransactionQuery.parse({
              categoryId: root.id,
              includeSubcategories: "true"
            })
          )
        ).items.map((row) => row.id)
      )
    ).toEqual(new Set([direct.id, nested.id]));
    const summary = await createDashboardService(db).summary(alice.id, {
      from: "2026-10-30",
      to: "2026-10-30",
      currency: "CAD",
      recentLimit: 5
    });
    expect(
      summary.categoryBreakdown.find((row) => row.categoryId === root.id)
        ?.expensesMinor
    ).toBe(123);
    expect(
      summary.rootCategoryBreakdown.find((row) => row.categoryId === root.id)
        ?.expensesMinor
    ).toBe(579);
  });
  it("serializes archive vs child creation and posting, and concurrent duplicate siblings", async () => {
    const root = await create("Race root");
    const child = await create("Race child", root.id);
    const outcomes = await Promise.allSettled([
      categories.archive(alice.id, root.id),
      create("Concurrent child", root.id),
      posting(child.id)
    ]);
    expect(outcomes[0]!.status).toBe("fulfilled");
    const descendants = await db.category.findMany({
      where: { parentId: root.id }
    });
    expect(descendants.every((row) => row.archivedAt !== null)).toBe(true);
    await expect(posting(child.id)).rejects.toMatchObject({
      code: "INVALID_CATEGORY"
    });
    const active = await create("Duplicate race parent");
    const duplicates = await Promise.allSettled([
      create("Race same", active.id),
      create("Race same", active.id)
    ]);
    expect(duplicates.filter((row) => row.status === "fulfilled")).toHaveLength(
      1
    );
    expect(duplicates.find((row) => row.status === "rejected")).toMatchObject({
      reason: { code: "CATEGORY_NAME_CONFLICT" }
    });
  });
  it("serializes direct SQL child insertion with archival and rejects later SQL assignments", async () => {
    const root = await create("SQL race root");
    const sql = new pg.Client({ connectionString: database.url });
    await sql.connect();
    try {
      await sql.query("BEGIN");
      await sql.query('SELECT id FROM "User" WHERE id = $1 FOR UPDATE', [
        alice.id
      ]);
      const inserted = await sql.query(
        'INSERT INTO "Category" ("userId", name, "parentId") VALUES ($1, $2, $3) RETURNING id',
        [alice.id, "SQL racing child", root.id]
      );
      const pendingArchive = categories.archive(alice.id, root.id);
      await sql.query("COMMIT");
      await pendingArchive;
      const childId = inserted.rows[0].id as string;
      expect(
        (await categories.get(alice.id, childId)).archivedAt
      ).not.toBeNull();
      await expect(
        sql.query(
          "INSERT INTO \"Transaction\" (\"userId\", \"categoryId\", direction, \"amountMinor\", currency, date, merchant) VALUES ($1, $2, 'expense', 1, 'CAD', '2026-10-30', 'Synthetic')",
          [alice.id, childId]
        )
      ).rejects.toMatchObject({ code: "23514" });
    } finally {
      await sql.query("ROLLBACK");
      await sql.end();
    }
  });
  it("keeps legacy category routes from exposing writable hierarchy/catalog rows", async () => {
    for (const [method, url, payload] of [
      ["GET", "/v1/categories", undefined],
      ["POST", "/v1/categories", { name: "Legacy write" }]
    ] as const) {
      const reply = await app.inject({
        method,
        url,
        headers: headers(),
        ...(payload ? { payload } : {})
      });
      expect(reply.statusCode, reply.body).toBe(409);
      expect(reply.json().error.code).toBe("FINANCE_UPGRADE_REQUIRED");
    }
  });
  it("rejects stale repeatable-read child/assignment writes after archival", async () => {
    const sql = new pg.Client({ connectionString: database.url });
    await sql.connect();
    try {
      const root = await create("Snapshot parent");
      await sql.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
      await sql.query('SELECT id FROM "Category" WHERE id = $1', [root.id]);
      await categories.archive(alice.id, root.id);
      await expect(
        sql.query(
          'INSERT INTO "Category" ("userId", name, "parentId") VALUES ($1, $2, $3)',
          [alice.id, "Stale child", root.id]
        )
      ).rejects.toMatchObject({ code: "40001" });
      await sql.query("ROLLBACK");
      const parent = await create("Snapshot posting parent");
      const child = await create("Snapshot posting child", parent.id);
      await sql.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
      await sql.query('SELECT id FROM "Category" WHERE id = $1', [child.id]);
      await categories.archive(alice.id, parent.id);
      await expect(
        sql.query(
          "INSERT INTO \"Transaction\" (\"userId\", \"categoryId\", direction, \"amountMinor\", currency, date, merchant) VALUES ($1, $2, 'expense', 1, 'CAD', '2026-10-30', 'Synthetic')",
          [alice.id, child.id]
        )
      ).rejects.toMatchObject({ code: "40001" });
    } finally {
      await sql.query("ROLLBACK");
      await sql.end();
    }
  });
});
