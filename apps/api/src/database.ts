import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "./generated/prisma/client.js";

// Callers supply configuration explicitly; importing this module opens no pool.
export function createDatabaseClient(
  databaseUrl: string,
  transactionOptions?: Prisma.PrismaClientOptions["transactionOptions"]
): PrismaClient {
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  const schema = new URL(databaseUrl).searchParams.get("schema") ?? undefined;
  return new PrismaClient({
    adapter: new PrismaPg(
      { connectionString: databaseUrl },
      schema ? { schema } : {}
    ),
    ...(transactionOptions ? { transactionOptions } : {})
  });
}
