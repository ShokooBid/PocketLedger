import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import pg from "pg";
import { createDatabaseClient } from "../../src/database.js";

export function disposableDatabase() {
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
    async start() {
      await admin.connect();
      connected = true;
      await admin.query(`CREATE DATABASE "${name}"`);
      created = true;
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
