import process from "node:process";
import { readConfig } from "./config.js";
import { createDatabaseClient } from "./database.js";
import { createAuthService } from "./auth/service.js";
import { googleVerifier } from "./auth/google.js";

const config = readConfig(process.env);
const db = createDatabaseClient(config.databaseUrl);
try {
  const auth = await createAuthService(db, config, googleVerifier(config));
  console.info(
    `Removed ${await auth.cleanup()} expired/revoked session families (maximum 500 per run).`
  );
} finally {
  await db.$disconnect();
}
