import process from "node:process";
import { createDatabaseClient } from "../database.js";
import { initializeCategoryCatalog } from "./catalog-service.js";

const db = createDatabaseClient(process.env.DATABASE_URL ?? "");
try {
  if (process.argv.length > 2) throw new Error("No arguments accepted.");
  console.info(JSON.stringify(await initializeCategoryCatalog(db)));
} catch {
  // No connection strings, personal names or database exceptions in CLI output.
  console.error(
    "Catalog initialization failed. Apply the current schema and review catalog drift or visible name conflicts. No partial catalog was committed."
  );
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
