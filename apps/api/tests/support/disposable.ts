import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import pg from "pg";
import { createDatabaseClient } from "../../src/database.js";

// Local development and CI both supply a loopback PostgreSQL base URL. Every
// suite owns one random schema; application tables are never reset or dropped.
export function disposableDatabase(options: { migrate?: boolean } = {}) {
  const base = process.env.TEST_DATABASE_URL;
  if (!base)
    throw new Error("Set TEST_DATABASE_URL, or run test:integration:local.");
  const url = new URL(base);
  if (
    !/^postgres(ql)?:$/.test(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.search
  )
    throw new Error("Tests require a loopback PostgreSQL URL without options.");
  const name = "pocketledger_test_" + randomUUID().replaceAll("-", "");
  url.searchParams.set("schema", name);
  url.searchParams.set("options", "-c search_path=" + name);
  const db = createDatabaseClient(url.toString());
  const admin = new pg.Client({
    connectionString: base,
    connectionTimeoutMillis: 5000
  });
  let created = false,
    connected = false;
  return {
    db,
    url: url.toString(),
    async start() {
      await admin.connect();
      connected = true;
      await admin.query('CREATE SCHEMA "' + name + '"');
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
          // Only this generated, fixed-prefix UUID namespace is a cleanup target.
          if (created) await admin.query('DROP SCHEMA "' + name + '" CASCADE');
        } finally {
          if (connected) await admin.end();
        }
      }
    }
  };
}
