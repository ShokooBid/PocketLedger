import process from "node:process";
import { buildApp } from "./app.js";
import { readConfig } from "./config.js";
import { createDatabaseClient } from "./database.js";
import { googleVerifier } from "./auth/google.js";
import { createAuthService } from "./auth/service.js";
import { createCategoryService } from "./categories/service.js";
import { createTransactionService } from "./transactions/service.js";
import { createDashboardService } from "./dashboard/service.js";

// Explicit environment only; no implicit .env loading or configuration dumps.
const config = readConfig(process.env);
const db = createDatabaseClient(config.databaseUrl);
const auth = await createAuthService(db, config, googleVerifier(config));
const app = await buildApp(config, auth, {
  categories: createCategoryService(db),
  transactions: createTransactionService(db),
  dashboard: createDashboardService(db)
});
app.addHook("onClose", async () => {
  await db.$disconnect();
});
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void app.close();
  });
try {
  await app.listen({ host: config.host, port: config.port });
} catch {
  app.log.error("API startup failed.");
  await app.close();
  process.exitCode = 1;
}
