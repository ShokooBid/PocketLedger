import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { defineConfig } from "prisma/config";

// Explicit process variables win over the ignored repository-root .env.
const envPath = fileURLToPath(new URL("../../.env", import.meta.url));
if (existsSync(envPath)) process.loadEnvFile(envPath);

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts"
  },
  // Generation/validation work without credentials; database commands require it.
  datasource: { url: process.env.DATABASE_URL ?? "" }
});
