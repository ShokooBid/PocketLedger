import { mkdir, writeFile } from "node:fs/promises";
import { buildApp } from "./app.js";
import { readConfig } from "./config.js";
import type { AuthService } from "./auth/service.js";
import type { CategoryService } from "./categories/service.js";
import type { TransactionService } from "./transactions/service.js";
import type { DashboardService } from "./dashboard/service.js";
import type { PreferencesService } from "./preferences/service.js";

// Route registration only: no database connection, provider call or credentials.
const config = readConfig({
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://unused:unused@127.0.0.1/unused",
  ACCESS_TOKEN_SECRET: "A".repeat(43)
});
const app = await buildApp(config, {} as AuthService, {
  logger: false,
  categories: {} as CategoryService,
  transactions: {} as TransactionService,
  dashboard: {} as DashboardService,
  preferences: {} as PreferencesService
});
try {
  await app.ready();
  await mkdir("dist", { recursive: true });
  await writeFile(
    "dist/openapi.json",
    JSON.stringify(app.swagger(), null, 2) + "\n"
  );
} finally {
  await app.close();
}
