import { randomBytes } from "node:crypto";
import { readConfig } from "../src/config.js";
import type { PrismaClient } from "../src/generated/prisma/client.js";

export function testConfig() {
  return readConfig({
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://unused:unused@127.0.0.1/unused",
    ACCESS_TOKEN_SECRET: randomBytes(32).toString("base64url"),
    GOOGLE_CLIENT_IDS: "synthetic-web-client",
    GOOGLE_PRESENTER_IDS: "synthetic-native-client",
    CORS_ORIGINS: "https://app.example.invalid"
  });
}

// Valid persisted fixtures use the same currency/account invariants as the API.
export async function testAccount(
  db: PrismaClient,
  userId: string,
  currency = "CAD"
) {
  await db.financePreferences.upsert({
    where: { userId },
    update: { entryCurrency: currency },
    create: { userId, entryCurrency: currency }
  });
  return db.account.create({
    data: {
      userId,
      name: `Test ${currency} ${crypto.randomUUID()}`,
      type: "cash",
      currency,
      openingDate: new Date("0001-01-01"),
      openingBalanceMinor: 0
    }
  });
}
