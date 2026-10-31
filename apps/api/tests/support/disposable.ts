import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import pg from "pg";
import { createDatabaseClient } from "../../src/database.js";

export function disposableDatabase(options: { migrate?: boolean } = {}) {
  if (process.env.TEST_USE_LOCAL_DATABASE === "true")
    return localSchemaDatabase(options.migrate !== false);
  const base = process.env.TEST_DATABASE_URL;
  if (!base)
    throw new Error("Set TEST_DATABASE_URL to the disposable test service.");
  const url = new URL(base);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.pathname !== "/pocketledger_test" ||
    url.search
  )
    throw new Error(
      "Use only a local pocketledger_test database without URL options."
    );
  const name = `pocketledger_test_${randomUUID().replaceAll("-", "")}`;
  url.pathname = `/${name}`;
  const admin = new pg.Client({
    connectionString: base,
    connectionTimeoutMillis: 5000
  });
  const db = createDatabaseClient(url.toString());
  let created = false;
  let connected = false;
  return {
    db,
    url: url.toString(),
    async start() {
      await admin.connect();
      connected = true;
      await admin.query(`CREATE DATABASE "${name}"`);
      created = true;
      if (options.migrate === false) return;
      await promisify(execFile)(
        process.execPath,
        [
          createRequire(import.meta.url).resolve("prisma/build/index.js"),
          "migrate",
          "deploy"
        ],
        {
          cwd: fileURLToPath(new URL("../../", import.meta.url)),
          env: {
            ...process.env,
            DATABASE_URL: url.toString(),
            NODE_ENV: "test"
          },
          timeout: 120000,
          windowsHide: true
        }
      );
    },
    async close() {
      try {
        await db.$disconnect();
      } finally {
        try {
          if (created)
            await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
        } finally {
          if (connected) await admin.end();
        }
      }
    }
  };
}

// Opt-in reuse of the main LOCAL database. Every run owns an isolated schema;
// no public rows, tables or databases are ever truncated, deleted or dropped.
function localSchemaDatabase(migrate: boolean) {
  const base = process.env.DATABASE_URL;
  if (!base)
    throw new Error("Local tests require DATABASE_URL from the root .env.");
  const url = new URL(base);
  if (
    !/^postgres(ql)?:$/.test(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.search
  )
    throw new Error(
      "Local tests require a loopback database URL without options."
    );
  const name = `pocketledger_test_${randomUUID().replaceAll("-", "")}`;
  url.searchParams.set("schema", name);
  url.searchParams.set("options", `-c search_path=${name}`);
  const db = createDatabaseClient(url.toString());
  const admin = new pg.Client({
    connectionString: base,
    connectionTimeoutMillis: 5000
  });
  let created = false;
  let connected = false;
  return {
    db,
    url: url.toString(),
    async start() {
      await admin.connect();
      connected = true;
      await admin.query(`CREATE SCHEMA "${name}"`);
      created = true;
      if (!migrate) return;
      await promisify(execFile)(
        process.execPath,
        [
          createRequire(import.meta.url).resolve("prisma/build/index.js"),
          "migrate",
          "deploy"
        ],
        {
          cwd: fileURLToPath(new URL("../../", import.meta.url)),
          env: {
            ...process.env,
            DATABASE_URL: url.toString(),
            NODE_ENV: "test"
          },
          timeout: 120000,
          windowsHide: true
        }
      );
    },
    async close() {
      try {
        await db.$disconnect();
      } finally {
        try {
          // Name generated above, with a fixed prefix and UUID only. Never a
          // user/configured schema; CASCADE reaches only this fixture namespace.
          if (created) await admin.query(`DROP SCHEMA "${name}" CASCADE`);
        } finally {
          if (connected) await admin.end();
        }
      }
    }
  };
}
