import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";

// Callers supply configuration explicitly; importing this module opens no pool.
export function createDatabaseClient(databaseUrl: string): PrismaClient {
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl })
  });
}
