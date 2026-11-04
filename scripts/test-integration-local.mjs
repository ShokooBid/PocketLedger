import { spawnSync } from "node:child_process";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";

// Invoke npm through Node so the same command works on Windows and Unix.
const npm = process.env.npm_execpath;
if (!npm)
  throw new Error("Run this script with npm run test:integration:local.");

// The existing harness validates a loopback DATABASE_URL and owns a temporary
// schema for each suite. Only the child process receives this test connection.
const result = spawnSync(process.execPath, [npm, "run", "test:integration"], {
  cwd: fileURLToPath(new URL("../", import.meta.url)),
  env: { ...process.env, TEST_DATABASE_URL: process.env.DATABASE_URL },
  stdio: "inherit",
  windowsHide: true
});
if (result.error) console.error("Could not start the integration test runner.");
process.exitCode = result.status ?? 1;
