import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testAccount } from "../fixtures.js";
import { initializeCategoryCatalog } from "../../src/categories/catalog-service.js";
import { disposableDatabase } from "../support/disposable.js";

const require = createRequire(import.meta.url);
const execFileAsync = promisify(execFile);
const prismaCli = require.resolve("prisma/build/index.js");
const apiDirectory = fileURLToPath(new URL("../../", import.meta.url));
const database = disposableDatabase({ migrate: false });
const databaseUrl = database.url;
const sql = new pg.Client({
  connectionString: databaseUrl,
  connectionTimeoutMillis: 30_000
});
const db = database.db;
let sqlConnected = false;
const userA = randomUUID();
const userB = randomUUID();
const ownerAccounts = new Map<string, string>();
const categoryA = randomUUID();
const categoryB = randomUUID();
const importA = randomUUID();
const importB = randomUUID();

async function runPrisma(connectionString: string, ...args: string[]) {
  const { stdout } = await execFileAsync(
    process.execPath,
    [prismaCli, ...args],
    {
      cwd: apiDirectory,
      env: {
        ...process.env,
        DATABASE_URL: connectionString,
        ALLOW_SYNTHETIC_SEED: "true",
        NODE_ENV: "test"
      },
      encoding: "utf8",
      // Cold Prisma CLI startup can exceed 30 seconds on Windows. Keep a bound,
      // while allowing Vitest's event loop and database connections to progress.
      timeout: 120_000,
      windowsHide: true
    }
  );
  return stdout;
}

function prisma(...args: string[]) {
  return runPrisma(databaseUrl, ...args);
}

// Raw SQL intentionally bypasses Prisma's relation validation.
async function insertTransaction(
  owner: string = userA,
  category: string = categoryA,
  source: string | null = null
) {
  return sql.query(
    `INSERT INTO "Transaction"
      ("userId", "categoryId", "importId", "accountId", direction, "amountMinor", date, merchant)
     VALUES ($1, $2, $3, $4, 'expense', 1234, '2026-01-15', 'Synthetic shop')
     RETURNING id`,
    [
      owner,
      category,
      source,
      ownerAccounts.get(owner) ?? ownerAccounts.get(userA)
    ]
  );
}

beforeAll(async () => {
  await database.start();
  await sql.connect();
  sqlConnected = true;
  const tables = await sql.query(
    "SELECT tablename FROM pg_tables WHERE schemaname = current_schema()"
  );
  expect(tables.rows).toHaveLength(0);
  await prisma("migrate", "deploy");
  await initializeCategoryCatalog(db);
  for (const id of [userA, userB]) {
    await db.user.create({
      data: {
        id,
        email: `${id}@example.invalid`,
        passwordHash: "!disabled:test"
      }
    });
  }
  for (const id of [userA, userB])
    ownerAccounts.set(id, (await testAccount(db, id, "USD")).id);
  await db.category.createMany({
    data: [
      { id: categoryA, userId: userA, name: "Synthetic A" },
      { id: categoryB, userId: userB, name: "Synthetic B" }
    ]
  });
  await db.import.createMany({
    data: [
      { id: importA, userId: userA },
      { id: importB, userId: userB }
    ]
  });
});

afterAll(async () => {
  try {
    if (sqlConnected) await sql.end();
  } finally {
    await database.close();
  }
});

describe("initial migration and database ownership", () => {
  it("applies from zero and deploying again is a no-op", async () => {
    const migrations = (
      await readdir(new URL("../../prisma/migrations/", import.meta.url), {
        withFileTypes: true
      })
    )
      .filter((entry) => entry.isDirectory() && /^\d/.test(entry.name))
      .map((entry) => entry.name)
      .sort();
    const appliedMigrations =
      'SELECT * FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name';
    const before = await sql.query(appliedMigrations);
    expect(before.rows.map((row) => row.migration_name)).toEqual(migrations);

    await prisma("migrate", "deploy");
    const after = await sql.query(appliedMigrations);
    expect(after.rows).toEqual(before.rows);
    expect(await prisma("migrate", "status")).toContain("up to date");
  });

  it("keeps only account currency and an owner-safe posting foreign key", async () => {
    const retired =
      await sql.query(`SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = current_schema() AND
        ((table_name = 'Transaction' AND column_name = 'currency') OR
         (table_name = 'Account' AND column_name = 'legacyCurrency'))`);
    expect(retired.rows).toEqual([]);
    const foreignKey =
      await sql.query(`SELECT pg_get_constraintdef(oid) AS definition
      FROM pg_constraint WHERE conrelid = '"Transaction"'::regclass
        AND conname = 'Transaction_account_owner_fkey'`);
    expect(foreignKey.rows[0].definition).toContain(
      'FOREIGN KEY ("accountId", "userId") REFERENCES "Account"(id, "userId")'
    );
    const guards =
      await sql.query(`SELECT p.proname, pg_get_functiondef(p.oid) AS definition FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = current_schema()
        AND p.proname IN ('enforce_account_rules', 'enforce_account_posting')`);
    expect(guards.rows).toHaveLength(2);
    for (const guard of guards.rows) {
      expect(guard.definition).not.toContain("legacyCurrency");
      if (guard.proname === "enforce_account_posting")
        expect(guard.definition).not.toMatch(/(?:NEW|OLD)\.currency/);
    }
  });

  it("accepts same-owner manual and imported transactions", async () => {
    const manual = await insertTransaction();
    await insertTransaction(userA, categoryA, importA);
    const record = await db.transaction.findUniqueOrThrow({
      where: { id: manual.rows[0].id }
    });
    expect(record).toMatchObject({
      amountMinor: 1234,
      direction: "expense",
      importId: null
    });
    expect(record.date.toISOString()).toBe("2026-01-15T00:00:00.000Z");
    expect(record.createdAt).toBeInstanceOf(Date);
    // Avoid timing-sensitive assertions against two writes in one millisecond.
    await sql.query('UPDATE "Transaction" SET "updatedAt" = $1 WHERE id = $2', [
      "2000-01-01T00:00:00Z",
      record.id
    ]);
    const updated = await db.transaction.update({
      where: { id: record.id },
      data: { note: "Synthetic edit" }
    });
    expect(updated.updatedAt.getTime()).toBeGreaterThan(
      new Date("2000-01-01").getTime()
    );
  });

  it("stores nullable creation pairs, enforces owner-scoped uniqueness and prevents identity mutation", async () => {
    expect(
      (
        await sql.query(
          `SELECT to_regclass('"TransactionCreation"') AS retired`
        )
      ).rows[0].retired
    ).toBeNull();
    const columns =
      await sql.query(`SELECT column_name, is_nullable FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'Transaction'
        AND column_name IN ('clientRequestId', 'creationFingerprint') ORDER BY column_name`);
    expect(columns.rows).toEqual([
      { column_name: "clientRequestId", is_nullable: "YES" },
      { column_name: "creationFingerprint", is_nullable: "YES" }
    ]);
    const insert = (
      key: string | null,
      fingerprint: string | null,
      owner = userA
    ) =>
      sql.query(
        `INSERT INTO "Transaction" ("userId", "categoryId", "accountId", direction, "amountMinor", date, "clientRequestId", "creationFingerprint")
        VALUES ($1, $2, $3, 'expense', 1234, '2026-01-15', $4, $5) RETURNING id`,
        [
          owner,
          owner === userA ? categoryA : categoryB,
          ownerAccounts.get(owner),
          key,
          fingerprint
        ]
      );
    const key = randomUUID(),
      fingerprint = "a".repeat(64);
    for (const [requestId, digest] of [
      [key, null],
      [null, fingerprint],
      [key, "a".repeat(63)],
      [key, "A".repeat(64)],
      [key, "z".repeat(64)],
      [key, ""]
    ] as const)
      await expect(insert(requestId, digest)).rejects.toMatchObject({
        code: "23514"
      });
    const row = (await insert(key, fingerprint)).rows[0];
    await expect(insert(key, fingerprint)).rejects.toMatchObject({
      code: "23505"
    });
    await insert(key, fingerprint, userB);
    const internal = (await insert(null, null)).rows[0];
    await insert(null, null);
    await sql.query(
      'UPDATE "Transaction" SET "clientRequestId" = $1, "creationFingerprint" = $2 WHERE id = $3',
      [key, fingerprint, row.id]
    );
    for (const [requestId, digest] of [
      [randomUUID(), fingerprint],
      [key, "b".repeat(64)],
      [null, null]
    ] as const)
      await expect(
        sql.query(
          'UPDATE "Transaction" SET "clientRequestId" = $1, "creationFingerprint" = $2 WHERE id = $3',
          [requestId, digest, row.id]
        )
      ).rejects.toMatchObject({
        code: "23514",
        constraint: "Transaction_creation_identity_immutable"
      });
    await expect(
      sql.query(
        'UPDATE "Transaction" SET "clientRequestId" = $1, "creationFingerprint" = $2 WHERE id = $3',
        [randomUUID(), fingerprint, internal.id]
      )
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "Transaction_creation_identity_immutable"
    });
    await sql.query('DELETE FROM "Transaction" WHERE id = $1', [row.id]);
    expect((await insert(key, fingerprint)).rows[0].id).not.toBe(row.id);
  });

  it("rejects another user's category through SQL and Prisma", async () => {
    await expect(insertTransaction(userA, categoryB)).rejects.toMatchObject({
      code: "23503"
    });
    await expect(
      db.transaction.create({
        data: {
          userId: userA,
          accountId: ownerAccounts.get(userA)!,
          categoryId: categoryB,
          direction: "expense",
          amountMinor: 1,
          date: new Date("2026-01-15"),
          merchant: "Synthetic"
        }
      })
    ).rejects.toMatchObject({ code: "P2003" });
  });

  it("rejects another user's import even when the category is valid", async () => {
    await expect(
      insertTransaction(userA, categoryA, importB)
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("rejects nonexistent owners, categories and imports", async () => {
    await expect(insertTransaction(randomUUID())).rejects.toThrow();
    await expect(insertTransaction(userA, randomUUID())).rejects.toMatchObject({
      code: "23503"
    });
    await expect(
      insertTransaction(userA, categoryA, randomUUID())
    ).rejects.toMatchObject({ code: "23503" });
    await expect(
      sql.query('INSERT INTO "Category" ("userId", name) VALUES ($1, $2)', [
        randomUUID(),
        "Missing owner"
      ])
    ).rejects.toMatchObject({ code: "23503" });
    await expect(
      sql.query('INSERT INTO "Import" ("userId") VALUES ($1)', [randomUUID()])
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("rejects changing a transaction's category, import or owner across users", async () => {
    const result = await insertTransaction(userA, categoryA, importA);
    const id = result.rows[0].id;
    for (const [column, value] of [
      ["categoryId", categoryB],
      ["importId", importB],
      ["userId", userB]
    ]) {
      await expect(
        sql.query(`UPDATE "Transaction" SET "${column}" = $1 WHERE id = $2`, [
          value,
          id
        ])
      ).rejects.toThrow();
    }
  });

  it("prevents reparenting or deleting referenced categories, imports and users", async () => {
    await insertTransaction(userA, categoryA, importA);
    for (const [table, id] of [
      ["Category", categoryA],
      ["Import", importA]
    ]) {
      await expect(
        sql.query(`UPDATE "${table}" SET "userId" = $1 WHERE id = $2`, [
          userB,
          id
        ])
      ).rejects.toThrow();
      await expect(
        sql.query(`DELETE FROM "${table}" WHERE id = $1`, [id])
      ).rejects.toMatchObject({ code: "23503" });
    }
    await expect(
      sql.query('DELETE FROM "User" WHERE id = $1', [userA])
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("archives a category without losing historical associations", async () => {
    const category = await db.category.create({
      data: { userId: userA, name: "Archive history" }
    });
    const result = await insertTransaction(userA, category.id);
    await db.category.update({
      where: { id: category.id },
      data: { archivedAt: new Date() }
    });
    const record = await db.transaction.findUniqueOrThrow({
      where: { id: result.rows[0].id },
      include: { category: true }
    });
    expect(record.category).not.toBeNull();
    expect(record.category?.archivedAt).toBeInstanceOf(Date);
  });

  it("enforces positive integer money and required owners", async () => {
    const result = await insertTransaction();
    for (const amount of [0, -1]) {
      await expect(
        sql.query('UPDATE "Transaction" SET "amountMinor" = $1 WHERE id = $2', [
          amount,
          result.rows[0].id
        ])
      ).rejects.toMatchObject({ code: "23514" });
    }
    await expect(
      sql.query('UPDATE "Transaction" SET "amountMinor" = $1 WHERE id = $2', [
        "1.5",
        result.rows[0].id
      ])
    ).rejects.toMatchObject({ code: "22P02" });
    await expect(
      sql.query('UPDATE "Transaction" SET "userId" = NULL WHERE id = $1', [
        result.rows[0].id
      ])
    ).rejects.toThrow();
  });

  it("has owner-first indexes for date and category listing", async () => {
    const result = await sql.query(
      "SELECT indexdef FROM pg_indexes WHERE schemaname = current_schema() AND tablename = 'Transaction'"
    );
    const definitions = result.rows
      .map((row: { indexdef: string }) => row.indexdef)
      .join("\n");
    expect(definitions).toContain('("userId", date DESC, id DESC)');
    expect(definitions).toContain(
      '("userId", "categoryId", date DESC, id DESC)'
    );
  });

  it("runs the explicit seed command twice without duplicating or overwriting records", async () => {
    await prisma("db", "seed");
    const seedId = "00000000-0000-4000-8000-000000000005";
    const seedIdentity = await db.transaction.findUniqueOrThrow({
      where: { id: seedId }
    });
    expect(seedIdentity.clientRequestId).toBe(
      "00000000-0000-4000-8000-000000000008"
    );
    expect(seedIdentity.creationFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(
      await db.transaction.findUniqueOrThrow({
        where: { id: "00000000-0000-4000-8000-000000000006" }
      })
    ).toMatchObject({ clientRequestId: null, creationFingerprint: null });
    await db.transaction.update({
      where: { id: seedId },
      data: { note: "Synthetic local edit" }
    });
    const counts = await Promise.all([
      db.user.count(),
      db.category.count(),
      db.import.count(),
      db.transaction.count()
    ]);
    await prisma("db", "seed");
    expect(
      await Promise.all([
        db.user.count(),
        db.category.count(),
        db.import.count(),
        db.transaction.count()
      ])
    ).toEqual(counts);
    expect(
      await db.user.findUniqueOrThrow({
        where: { email: "demo@example.invalid" }
      })
    ).toMatchObject({
      passwordHash: "!disabled:synthetic-seed",
      disabledAt: new Date("2026-01-01T00:00:00Z")
    });
    expect(
      await db.transaction.findUniqueOrThrow({ where: { id: seedId } })
    ).toMatchObject({
      note: "Synthetic local edit",
      clientRequestId: seedIdentity.clientRequestId,
      creationFingerprint: seedIdentity.creationFingerprint
    });
  });
});

describe("authentication storage (service behavior is implemented in Issue #7)", () => {
  const future = new Date("2099-01-01T00:00:00Z");

  it("supports password-only, Google-only and explicitly linked accounts", async () => {
    expect(
      await db.user.findUniqueOrThrow({ where: { id: userA } })
    ).toMatchObject({ passwordHash: "!disabled:test" });
    const googleUser = await db.user.create({
      data: { email: "google-only@example.invalid" }
    });
    expect(googleUser.passwordHash).toBeNull();
    await db.authIdentity.create({
      data: {
        userId: googleUser.id,
        provider: "google",
        providerSubject: "synthetic-google-only"
      }
    });
    await db.authIdentity.create({
      data: {
        userId: userA,
        provider: "google",
        providerSubject: "synthetic-linked"
      }
    });
    const linked = await db.user.findUniqueOrThrow({
      where: { id: userA },
      include: { identities: true }
    });
    expect(linked.passwordHash).toBe("!disabled:test");
    expect(linked.identities).toHaveLength(1);
  });

  it("rejects duplicate Google subjects, duplicate provider links and missing identity owners", async () => {
    const owner = await db.user.create({
      data: { email: "identity-owner@example.invalid" }
    });
    await db.authIdentity.create({
      data: {
        userId: owner.id,
        provider: "google",
        providerSubject: "synthetic-unique"
      }
    });
    const insert = (userId: string, subject: string) =>
      sql.query(
        'INSERT INTO "AuthIdentity" ("userId", provider, "providerSubject") VALUES ($1, \'google\', $2)',
        [userId, subject]
      );
    await expect(insert(userB, "synthetic-unique")).rejects.toMatchObject({
      code: "23505"
    });
    await expect(insert(owner.id, "synthetic-other")).rejects.toMatchObject({
      code: "23505"
    });
    await expect(
      insert(randomUUID(), "synthetic-orphan")
    ).rejects.toMatchObject({ code: "23503" });
    await expect(insert(userB, "")).rejects.toMatchObject({ code: "23514" });
  });

  it("retains consumed token hashes and persists a session revocation boundary", async () => {
    const session = await db.session.create({
      data: { userId: userB, expiresAt: future }
    });
    const oldToken = await db.refreshToken.create({
      data: {
        sessionId: session.id,
        tokenHash: "a".repeat(64),
        expiresAt: future
      }
    });
    await db.$transaction([
      db.refreshToken.update({
        where: { id: oldToken.id },
        data: { consumedAt: new Date() }
      }),
      db.refreshToken.create({
        data: {
          sessionId: session.id,
          tokenHash: "b".repeat(64),
          expiresAt: future
        }
      })
    ]);
    expect(
      (
        await db.refreshToken.findUniqueOrThrow({
          where: { tokenHash: oldToken.tokenHash }
        })
      ).consumedAt
    ).not.toBeNull();
    await db.session.update({
      where: { id: session.id },
      data: { revokedAt: new Date() }
    });
    const revoked = await db.session.findUniqueOrThrow({
      where: { id: session.id },
      include: { refreshTokens: true }
    });
    expect(revoked.revokedAt).not.toBeNull();
    expect(revoked.refreshTokens).toHaveLength(2);
    // This proves storage capability, not endpoint-level rotation/replay rejection.
    await expect(
      sql.query('DELETE FROM "Session" WHERE id = $1', [session.id])
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("rejects orphan sessions/tokens, duplicate or malformed hashes and invalid lifetimes", async () => {
    await expect(
      sql.query(
        'INSERT INTO "Session" ("userId", "expiresAt") VALUES ($1, $2)',
        [randomUUID(), future]
      )
    ).rejects.toMatchObject({ code: "23503" });
    await expect(
      sql.query(
        'INSERT INTO "Session" ("userId", "expiresAt") VALUES ($1, $2)',
        [userB, new Date("2000-01-01")]
      )
    ).rejects.toMatchObject({ code: "23514" });
    const session = await db.session.create({
      data: { userId: userB, expiresAt: future }
    });
    const insert = (sessionId: string, tokenHash: string, expiry = future) =>
      sql.query(
        'INSERT INTO "RefreshToken" ("sessionId", "tokenHash", "expiresAt") VALUES ($1, $2, $3)',
        [sessionId, tokenHash, expiry]
      );
    await expect(insert(randomUUID(), "c".repeat(64))).rejects.toMatchObject({
      code: "23503"
    });
    await expect(
      insert(session.id, "raw-token-is-not-a-hash")
    ).rejects.toMatchObject({ code: "23514" });
    await expect(insert(session.id, "z".repeat(64))).rejects.toMatchObject({
      code: "23514"
    });
    await expect(
      insert(session.id, "d".repeat(64), new Date("2000-01-01"))
    ).rejects.toMatchObject({ code: "23514" });
    await insert(session.id, "e".repeat(64));
    await expect(insert(session.id, "e".repeat(64))).rejects.toMatchObject({
      code: "23505"
    });
  });
});
