import process from "node:process";
import { z } from "zod";
import { createDatabaseClient } from "../database.js";
import { currencySchema } from "../transactions/contracts.js";
import {
  backfillFinanceOwner,
  verifyFinanceMigration,
  prepareFinanceUpgrade,
  financeMigrationStatus
} from "./migration.js";

// Explicit maintenance command; never imported by API startup.
async function main() {
  const args = process.argv.slice(2);
  const command = z
    .enum(["status", "prepare", "backfill", "verify"])
    .parse(args.shift());
  const input: Record<string, unknown> = { apply: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--apply") input.apply = true;
    else if (["--user", "--currency", "--after", "--limit"].includes(arg!)) {
      const value = args[++i];
      if (!value || value.startsWith("--"))
        throw new Error("Missing argument.");
      input[arg!.slice(2)] = value;
    } else throw new Error("Unknown argument.");
  }
  const options = z
    .strictObject({
      apply: z.boolean(),
      user: z.uuid().optional(),
      currency: currencySchema.optional(),
      after: z.uuid().optional(),
      limit: z.coerce.number().int().min(1).max(100).default(20)
    })
    .parse(input);
  if (options.currency && !options.user)
    throw new Error("Currency choices require one explicit owner.");
  if (options.user && options.after)
    throw new Error("Choose an owner or a cursor.");
  if (
    command !== "backfill" &&
    (options.user ||
      options.currency ||
      options.after ||
      input.limit !== undefined)
  )
    throw new Error("Owner options belong to backfill only.");
  if (command === "status" && options.apply)
    throw new Error("Status is read-only.");
  const db = createDatabaseClient(process.env.DATABASE_URL ?? "");
  try {
    if (command === "status") {
      console.info(
        JSON.stringify({
          rollout: await financeMigrationStatus(db),
          unlinked: (
            await db.$queryRaw<
              { count: string }[]
            >`SELECT count(*)::text AS count FROM "Transaction" WHERE "accountId" IS NULL`
          )[0]?.count
        })
      );
    } else if (command === "prepare" || command === "verify") {
      if (command === "prepare" && !options.apply)
        throw new Error("Preparation requires --apply.");
      console.info(
        JSON.stringify({
          phase:
            command === "prepare"
              ? await prepareFinanceUpgrade(db)
              : await verifyFinanceMigration(db)
        })
      );
    } else {
      const owners = options.user
        ? [{ id: options.user }]
        : await db.user.findMany({
            where: options.after ? { id: { gt: options.after } } : {},
            orderBy: { id: "asc" },
            take: options.limit + 1,
            select: { id: true }
          });
      for (const owner of owners.slice(0, options.limit)) {
        const result = await backfillFinanceOwner(db, owner.id, {
          apply: options.apply,
          ...(options.currency ? { entryCurrency: options.currency } : {})
        });
        console.info(
          JSON.stringify({
            mode: options.apply ? "apply" : "preview",
            ...result
          })
        );
        if (result.conflicts.length) process.exitCode = 2;
      }
      console.info(
        JSON.stringify({
          nextCursor:
            owners.length > options.limit ? owners[options.limit - 1]!.id : null
        })
      );
    }
  } finally {
    await db.$disconnect();
  }
}
try {
  await main();
} catch {
  // Never print database exceptions, URLs or stored financial text.
  console.error(
    "Finance migration failed. Review the command arguments and migration state. The current owner/transition was rolled back; retry after resolving the conflict."
  );
  console.error(
    "Usage: finance:migrate status | prepare --apply | backfill [--user UUID --currency CODE | --after UUID] [--limit 1-100] [--apply] | verify"
  );
  process.exitCode = 1;
}
