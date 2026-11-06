import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAuthService } from "../../src/auth/service.js";
import { defaultCategoryCatalog } from "../../src/categories/catalog.v1.js";
import { initializeCategoryCatalog } from "../../src/categories/catalog-service.js";
import { createCategoryService } from "../../src/categories/service.js";
import { createTransactionService } from "../../src/transactions/service.js";
import { createDashboardService } from "../../src/dashboard/service.js";
import { categoryQuery } from "../../src/categories/contracts.js";
import { transactionQuery } from "../../src/transactions/contracts.js";
import { testAccount, testConfig } from "../fixtures.js";
import { disposableDatabase } from "../support/disposable.js";

const database = disposableDatabase({ catalog: false }),
  db = database.db;
const categories = createCategoryService(db),
  transactions = createTransactionService(db);
const manifest = defaultCategoryCatalog.items;
const root = manifest.find((item) => item.key === "food-drinks")!;
const child = manifest.find((item) => item.key === "food-drinks.groceries")!;
let auth: Awaited<ReturnType<typeof createAuthService>>;
let firstInitialization: string;
const password = "synthetic catalog passphrase";
async function initializeCommand() {
  const result = await promisify(execFile)(
    process.execPath,
    ["--import", "tsx", "src/categories/initialize.ts"],
    {
      cwd: fileURLToPath(new URL("../../", import.meta.url)),
      env: { ...process.env, DATABASE_URL: database.url, NODE_ENV: "test" },
      timeout: 120000,
      windowsHide: true
    }
  );
  return result.stdout;
}
async function owner() {
  const tokens = await auth.register(
    `${randomUUID()}@example.invalid`,
    password
  );
  const principal = await auth.authenticate(tokens.accessToken);
  return {
    ...principal,
    accountId: (await testAccount(db, principal.userId)).id
  };
}
async function post(
  user: Awaited<ReturnType<typeof owner>>,
  categoryId: string,
  amountMinor: number
) {
  return (
    await transactions.create(user.userId, {
      clientRequestId: randomUUID(),
      categoryId,
      accountId: user.accountId,
      direction: "expense",
      amountMinor,
      date: "2026-11-06",
      note: null
    })
  ).resource;
}
beforeAll(async () => {
  await database.start();
  firstInitialization = await initializeCommand();
  auth = await createAuthService(db, testConfig(), async (subject) => ({
    subject,
    email: `${subject}@example.invalid`,
    verifiedEmail: true
  }));
});
afterAll(async () => {
  await database.close();
});

describe("shared approved category catalog", () => {
  it("initializes once through the deployment CLI and preserves stable rows on rerun/concurrency", async () => {
    expect(JSON.parse(firstInitialization)).toEqual({
      catalogVersion: 1,
      created: 80,
      total: 80
    });
    const before = await db.category.findMany({
      where: { userId: null },
      orderBy: { id: "asc" }
    });
    expect(before).toHaveLength(80);
    expect(before.filter((row) => row.parentId === null)).toHaveLength(10);
    expect(new Set(before.map((row) => row.defaultKey)).size).toBe(80);
    for (const row of before) {
      const item = manifest.find((item) => item.key === row.defaultKey)!;
      expect(row).toMatchObject({
        id: item.id,
        name: item.name,
        isDefault: true,
        iconKey: item.iconKey,
        parentId: item.parentKey
          ? manifest.find((p) => p.key === item.parentKey)!.id
          : null
      });
    }
    expect(JSON.parse(await initializeCommand()).created).toBe(0);
    expect(
      await Promise.all([
        initializeCategoryCatalog(db),
        initializeCategoryCatalog(db)
      ])
    ).toEqual([
      { catalogVersion: 1, created: 0, total: 80 },
      { catalogVersion: 1, created: 0, total: 80 }
    ]);
    expect(
      await db.category.findMany({
        where: { userId: null },
        orderBy: { id: "asc" }
      })
    ).toEqual(before);
  });
  it("shares the same rows across password/Google signup, login and linking without category copies", async () => {
    const email = `${randomUUID()}@example.invalid`;
    const first = await auth.authenticate(
      (await auth.register(email, password)).accessToken
    );
    const second = await owner();
    await auth.login(email, password);
    const subject = randomUUID();
    const challenge = await auth.challenge("login");
    const google = await auth.authenticate(
      (
        await auth.googleLogin({
          challengeId: challenge.challengeId,
          nonce: challenge.nonce,
          idToken: subject
        })
      ).accessToken
    );
    const again = await auth.challenge("login");
    await auth.googleLogin({
      challengeId: again.challengeId,
      nonce: again.nonce,
      idToken: subject
    });
    const link = await auth.challenge("link", first);
    await auth.link(first, {
      challengeId: link.challengeId,
      nonce: link.nonce,
      idToken: randomUUID()
    });
    for (const userId of [first.userId, second.userId, google.userId]) {
      expect(await db.category.count({ where: { userId } })).toBe(0);
      expect(
        (
          await categories.list(userId, categoryQuery.parse({ limit: 100 }))
        ).items
          .map((row) => row.id)
          .sort()
      ).toEqual(manifest.map((row) => row.id).sort());
      expect((await categories.get(userId, child.id)).parentId).toBe(root.id);
    }
    expect(await db.category.count({ where: { userId: null } })).toBe(80);
  });
  it("enforces visible normalized siblings, personal privacy and shared immutability through services and SQL", async () => {
    const alice = await owner(),
      bob = await owner();
    const own = await categories.create(alice.userId, {
      name: "Private common",
      parentId: root.id
    });
    const ownRoot = await categories.create(alice.userId, {
      name: "Private root"
    });
    await categories.create(bob.userId, {
      name: "Private common",
      parentId: root.id
    });
    await expect(
      categories.create(alice.userId, { name: "  FOOD &\tDrinks " })
    ).rejects.toMatchObject({ code: "CATEGORY_NAME_CONFLICT" });
    await expect(
      categories.create(alice.userId, {
        name: "  GROCERIES ",
        parentId: root.id
      })
    ).rejects.toMatchObject({ code: "CATEGORY_NAME_CONFLICT" });
    await expect(
      categories.update(alice.userId, own.id, { name: "Groceries" })
    ).rejects.toMatchObject({ code: "CATEGORY_NAME_CONFLICT" });
    await expect(categories.get(bob.userId, own.id)).rejects.toMatchObject({
      code: "NOT_FOUND"
    });
    await expect(
      categories.create(bob.userId, { name: "Foreign child", parentId: own.id })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    for (const id of [root.id, child.id]) {
      await expect(
        categories.update(alice.userId, id, { name: "Change" })
      ).rejects.toMatchObject({ code: "DEFAULT_CATEGORY_READ_ONLY" });
      await expect(categories.archive(bob.userId, id)).rejects.toMatchObject({
        code: "DEFAULT_CATEGORY_READ_ONLY"
      });
      await expect(
        db.category.update({ where: { id }, data: { name: "Direct change" } })
      ).rejects.toThrow();
      await expect(db.category.delete({ where: { id } })).rejects.toThrow();
    }
    for (const data of [
      {
        userId: alice.userId,
        name: "Forged",
        isDefault: true,
        defaultKey: "forged"
      },
      { userId: alice.userId, name: "Forged key", defaultKey: "forged" },
      { userId: null, name: "Missing identity" },
      { userId: null, name: "Missing key", isDefault: true },
      {
        userId: null,
        name: "Owned parent",
        isDefault: true,
        defaultKey: "test.parent",
        parentId: own.id
      },
      {
        userId: null,
        name: "Personal root parent",
        isDefault: true,
        defaultKey: "test.private-root",
        parentId: ownRoot.id
      },
      {
        userId: null,
        name: " FOOD &\tDrinks ",
        isDefault: true,
        defaultKey: "test.duplicate-root"
      },
      {
        userId: null,
        name: "Duplicate catalog key",
        isDefault: true,
        defaultKey: root.key
      },
      {
        userId: null,
        name: "GROCERIES",
        isDefault: true,
        defaultKey: "test.duplicate-child",
        parentId: root.id
      },
      { userId: bob.userId, name: "Foreign SQL child", parentId: own.id },
      { userId: bob.userId, name: "Deep SQL child", parentId: child.id }
    ])
      await expect(db.category.create({ data })).rejects.toThrow();
    await expect(
      db.category.create({
        data: { userId: alice.userId, name: "Groceries", parentId: root.id }
      })
    ).rejects.toThrow();
    const active = await categories.create(alice.userId, {
      name: "Archive and reuse",
      parentId: root.id
    });
    await categories.archive(alice.userId, active.id);
    expect(
      (
        await categories.create(alice.userId, {
          name: "Archive and reuse",
          parentId: root.id
        })
      ).id
    ).not.toBe(active.id);
  });
  it("scopes recents, root/child filters and reports to owned postings on shared category IDs", async () => {
    const alice = await owner(),
      bob = await owner();
    const personal = await categories.create(alice.userId, {
      name: "Alice private",
      parentId: root.id
    });
    const direct = await post(alice, root.id, 123),
      nested = await post(alice, child.id, 456);
    await post(alice, personal.id, 21);
    const foreign = await post(bob, child.id, 99999);
    await expect(post(bob, personal.id, 1)).rejects.toMatchObject({
      code: "NOT_FOUND"
    });
    await expect(
      db.transaction.create({
        data: {
          userId: bob.userId,
          accountId: bob.accountId,
          categoryId: personal.id,
          amountMinor: 1,
          direction: "expense",
          date: new Date("2026-11-06")
        }
      })
    ).rejects.toThrow();
    const filtered = await transactions.list(
      alice.userId,
      transactionQuery.parse({
        categoryId: root.id,
        includeSubcategories: "true"
      })
    );
    expect(
      (
        await transactions.list(
          alice.userId,
          transactionQuery.parse({ categoryId: root.id })
        )
      ).items.map((row) => row.id)
    ).toEqual([direct.id]);
    expect(filtered.items).toHaveLength(3);
    expect(filtered.items.map((row) => row.id)).toEqual(
      expect.arrayContaining([direct.id, nested.id])
    );
    expect(filtered.items.some((row) => row.id === foreign.id)).toBe(false);
    const result = await createDashboardService(db).summary(alice.userId, {
      from: "2026-11-06",
      to: "2026-11-06",
      currency: "CAD",
      recentLimit: 20
    });
    expect(result.expensesMinor).toBe(600);
    expect(result.rootCategoryBreakdown).toEqual([
      {
        categoryId: root.id,
        categoryName: root.name,
        incomeMinor: 0,
        expensesMinor: 600,
        netMinor: -600
      }
    ]);
    expect(
      (await categories.recent(bob.userId, 20)).items.map((row) => row.id)
    ).toEqual([child.id]);
    expect(
      (await categories.recent(alice.userId, 20)).items
        .map((row) => row.id)
        .sort()
    ).toEqual([root.id, child.id, personal.id].sort());
    const all: string[] = [];
    let after: string | undefined;
    do {
      const page = await categories.list(
        bob.userId,
        categoryQuery.parse({ limit: 7, after })
      );
      all.push(...page.items.map((row) => row.id));
      after = page.nextCursor ?? undefined;
    } while (after);
    expect(all).not.toContain(personal.id);
    expect(new Set(all).size).toBe(all.length);
    expect(
      (
        await categories.list(bob.userId, categoryQuery.parse({ q: "grocer" }))
      ).items.map((row) => row.id)
    ).toEqual([child.id]);
  });
  it("rolls initialization back on a visible personal-name collision without adopting private rows", async () => {
    const isolated = disposableDatabase({ catalog: false });
    try {
      await isolated.start();
      const user = await isolated.db.user.create({
        data: { email: `${randomUUID()}@example.invalid` }
      });
      const lastRoot = [...manifest]
        .reverse()
        .find((item) => item.parentKey === null)!;
      const personal = await isolated.db.category.create({
        data: { userId: user.id, name: lastRoot.name }
      });
      await expect(initializeCategoryCatalog(isolated.db)).rejects.toThrow();
      expect(
        await isolated.db.category.count({ where: { userId: null } })
      ).toBe(0);
      expect(
        await isolated.db.category.findUnique({ where: { id: personal.id } })
      ).toEqual(personal);
    } finally {
      await isolated.close();
    }
  });
  it("refuses catalog drift without rewriting data or committing a partial catalog", async () => {
    const isolated = disposableDatabase({ catalog: false });
    try {
      await isolated.start();
      await isolated.db.category.create({
        data: {
          id: root.id,
          userId: null,
          isDefault: true,
          defaultKey: root.key,
          name: "Unexpected label"
        }
      });
      await expect(initializeCategoryCatalog(isolated.db)).rejects.toThrow(
        "approved manifest"
      );
      expect(await isolated.db.category.count()).toBe(1);
      expect(
        (
          await isolated.db.category.findUniqueOrThrow({
            where: { id: root.id }
          })
        ).name
      ).toBe("Unexpected label");
    } finally {
      await isolated.close();
    }
  });
});
