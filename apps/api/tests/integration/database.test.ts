import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabaseClient } from "../../src/database.js";

const require = createRequire(import.meta.url);
const execFileAsync = promisify(execFile);
const prismaCli = require.resolve("prisma/build/index.js");
const apiDirectory = fileURLToPath(new URL("../../", import.meta.url));
// Never use DATABASE_URL or load .env here. The parent DB is only an admin entry.
const baseUrl = process.env.TEST_DATABASE_URL;
if (!baseUrl)
  throw new Error("Set TEST_DATABASE_URL to the disposable test service.");
const url = new URL(baseUrl);
if (
  !["postgresql:", "postgres:"].includes(url.protocol) ||
  !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
  url.pathname !== "/pocketledger_test" ||
  url.search !== ""
) {
  throw new Error(
    "Tests require a local pocketledger_test database without URL options."
  );
}

const databaseName = `pocketledger_test_${randomUUID().replaceAll("-", "")}`;
url.pathname = `/${databaseName}`;
const databaseUrl = url.toString();
const admin = new pg.Client({
  connectionString: baseUrl,
  connectionTimeoutMillis: 5000
});
const sql = new pg.Client({
  connectionString: databaseUrl,
  connectionTimeoutMillis: 5000
});
const db = createDatabaseClient(databaseUrl);
let created = false;
let adminConnected = false;
let sqlConnected = false;
const userA = randomUUID();
const userB = randomUUID();
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
      ("userId", "categoryId", "importId", direction, "amountMinor", currency, date, merchant)
     VALUES ($1, $2, $3, 'expense', 1234, 'USD', '2026-01-15', 'Synthetic shop')
     RETURNING id`,
    [owner, category, source]
  );
}

beforeAll(async () => {
  await admin.connect();
  adminConnected = true;
  // Identifier is generated internally from a UUID, never taken from input.
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  created = true;
  await sql.connect();
  sqlConnected = true;
  const tables = await sql.query(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public'"
  );
  expect(tables.rows).toHaveLength(0);
  await prisma("migrate", "deploy");
  for (const id of [userA, userB]) {
    await db.user.create({
      data: {
        id,
        email: `${id}@example.invalid`,
        passwordHash: "!disabled:test"
      }
    });
  }
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
    await db.$disconnect();
    if (sqlConnected) await sql.end();
  } finally {
    try {
      // Warning: deletes only this run's newly created synthetic database.
      if (created)
        await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
    } finally {
      if (adminConnected) await admin.end();
    }
  }
});

describe("initial migration and database ownership", () => {
  it("applies from zero and deploying again is a no-op", async () => {
    await prisma("migrate", "deploy");
    const result = await sql.query(
      'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL'
    );
    expect(result.rows).toHaveLength(5);
    expect(await prisma("migrate", "status")).toContain("up to date");
  });

  it("accepts same-owner manual and imported transactions", async () => {
    const manual = await insertTransaction();
    await insertTransaction(userA, categoryA, importA);
    const record = await db.transaction.findUniqueOrThrow({
      where: { id: manual.rows[0].id }
    });
    expect(record).toMatchObject({
      amountMinor: 1234,
      currency: "USD",
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

  it("rejects another user's category through SQL and Prisma", async () => {
    await expect(insertTransaction(userA, categoryB)).rejects.toMatchObject({
      code: "23503"
    });
    await expect(
      db.transaction.create({
        data: {
          userId: userA,
          categoryId: categoryB,
          direction: "expense",
          amountMinor: 1,
          currency: "USD",
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
    await expect(insertTransaction(randomUUID())).rejects.toMatchObject({
      code: "23503"
    });
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
      ).rejects.toMatchObject({ code: "23503" });
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
      ).rejects.toMatchObject({ code: "23503" });
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
    expect(record.category.archivedAt).toBeInstanceOf(Date);
  });

  it("enforces positive integer money, currency syntax and required owners", async () => {
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
    for (const currency of ["usd", "US", "12!"]) {
      await expect(
        sql.query('UPDATE "Transaction" SET currency = $1 WHERE id = $2', [
          currency,
          result.rows[0].id
        ])
      ).rejects.toMatchObject({ code: "23514" });
    }
    await expect(
      sql.query('UPDATE "Transaction" SET "userId" = NULL WHERE id = $1', [
        result.rows[0].id
      ])
    ).rejects.toMatchObject({ code: "23502" });
  });

  it("has owner-first indexes for date and category listing", async () => {
    const result = await sql.query(
      "SELECT indexdef FROM pg_indexes WHERE tablename = 'Transaction'"
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
    ).toMatchObject({ note: "Synthetic local edit" });
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

  it("upgrades the original schema without losing an existing user or transaction", async () => {
    const upgradeName = `${databaseName}_upgrade`;
    const upgradeUrl = new URL(databaseUrl);
    upgradeUrl.pathname = `/${upgradeName}`;
    const upgrade = new pg.Client({
      connectionString: upgradeUrl.toString(),
      connectionTimeoutMillis: 5000
    });
    let upgradeCreated = false;
    let upgradeConnected = false;
    try {
      await admin.query(`CREATE DATABASE "${upgradeName}"`);
      upgradeCreated = true;
      await upgrade.connect();
      upgradeConnected = true;
      // Reproduce the already-shared initial SQL, then register its baseline.
      await upgrade.query(
        await readFile(
          new URL(
            "../../prisma/migrations/20261017000000_init/migration.sql",
            import.meta.url
          ),
          "utf8"
        )
      );
      await upgrade.query(
        'INSERT INTO "User" (id, email, "passwordHash") VALUES ($1, $2, $3)',
        [userA, "upgrade@example.invalid", "!disabled:preserve-me"]
      );
      await upgrade.query(
        'INSERT INTO "Category" (id, "userId", name) VALUES ($1, $2, $3)',
        [categoryA, userA, "Synthetic preserved category"]
      );
      await upgrade.query(
        "INSERT INTO \"Transaction\" (\"userId\", \"categoryId\", direction, \"amountMinor\", currency, date, merchant) VALUES ($1, $2, 'expense', 1234, 'USD', '2026-01-01', 'Synthetic preserved merchant')",
        [userA, categoryA]
      );
      // An old exact-name schema can contain newly conflicting active names.
      // The new migration must fail atomically rather than merge historic IDs.
      const collisionId = randomUUID();
      await upgrade.query(
        'INSERT INTO "Category" (id, "userId", name) VALUES ($1, $2, $3)',
        [collisionId, userA, " synthetic  PRESERVED category "]
      );
      await expect(
        upgrade.query(
          await readFile(
            new URL(
              "../../prisma/migrations/20261022000000_categories/migration.sql",
              import.meta.url
            ),
            "utf8"
          )
        )
      ).rejects.toMatchObject({ code: "23505" });
      await upgrade.query("ROLLBACK");
      expect(
        (
          await upgrade.query(
            `SELECT indexname FROM pg_indexes WHERE indexname = 'Category_userId_name_key'`
          )
        ).rows
      ).toHaveLength(1);
      expect(
        (await upgrade.query('SELECT id FROM "Category"')).rows
      ).toHaveLength(2);
      // This is a disposable fixture; resolve its synthetic collision explicitly.
      await upgrade.query('DELETE FROM "Category" WHERE id = $1', [
        collisionId
      ]);
      await runPrisma(
        upgradeUrl.toString(),
        "migrate",
        "resolve",
        "--applied",
        "20261017000000_init"
      );
      await runPrisma(upgradeUrl.toString(), "migrate", "deploy");
      expect(
        (
          await upgrade.query(
            'SELECT "passwordHash" FROM "User" WHERE id = $1',
            [userA]
          )
        ).rows[0]
      ).toEqual({ passwordHash: "!disabled:preserve-me" });
      expect(
        (
          await upgrade.query(
            'SELECT "amountMinor", merchant FROM "Transaction"'
          )
        ).rows
      ).toEqual([
        { amountMinor: 1234, merchant: "Synthetic preserved merchant" }
      ]);
      await upgrade.query('INSERT INTO "User" (email) VALUES ($1)', [
        "new-google@example.invalid"
      ]);
      expect(
        (
          await upgrade.query(
            'SELECT count(*)::int AS count FROM "AuthIdentity"'
          )
        ).rows[0]
      ).toEqual({ count: 0 });
    } finally {
      try {
        if (upgradeConnected) await upgrade.end();
      } finally {
        if (upgradeCreated)
          await admin.query(`DROP DATABASE "${upgradeName}" WITH (FORCE)`);
      }
    }
  });
});
