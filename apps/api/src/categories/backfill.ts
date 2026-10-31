import process from "node:process";
import { z } from "zod";
import { createDatabaseClient } from "../database.js";
import { backfillCategoryCatalog } from "./provision.js";

const args = process.argv.slice(2);
let options:
  | {
      limit: number;
      after?: string | undefined;
      apply: boolean;
      local: boolean;
    }
  | undefined;
try {
  const input: Record<string, unknown> = { apply: false, local: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--apply") input.apply = true;
    else if (arg === "--local") input.local = true;
    else if (arg === "--limit" || arg === "--after") {
      if (!args[i + 1]) throw new Error("Missing argument.");
      input[arg.slice(2)] = args[++i];
    } else throw new Error("Unknown argument.");
  }
  options = z
    .strictObject({
      limit: z.coerce.number().int().min(1).max(100).default(20),
      after: z.uuid().optional(),
      apply: z.boolean(),
      local: z.boolean()
    })
    .parse(input);
  if (
    options.local &&
    !["localhost", "127.0.0.1", "[::1]"].includes(
      new URL(process.env.DATABASE_URL ?? "").hostname
    )
  )
    throw new Error("Local database required.");
} catch {
  options = undefined;
  console.error(
    "Usage: categories:backfill [--local] [--limit 1-100] [--after UUID] [--apply]; --local requires a loopback database."
  );
  process.exitCode = 1;
}
if (options) {
  if (options.apply && process.env.FINANCE_CATEGORIES_ENABLED !== "true") {
    console.error(
      "Enable category preview before applying the catalog; the rollout remains disabled by default."
    );
    process.exitCode = 1;
  } else {
    const db = createDatabaseClient(process.env.DATABASE_URL ?? "");
    try {
      const result = await backfillCategoryCatalog(db, options);
      // IDs and fixed catalog keys only; no emails or personal category names.
      console.info(
        JSON.stringify(
          { mode: options.apply ? "apply" : "preview", ...result },
          null,
          2
        )
      );
      if (result.results.some((owner) => owner.conflicts.length))
        process.exitCode = 2;
    } catch {
      console.error(
        "Catalog backfill failed. No partial owner tree was committed; retry the same page after resolving the database problem."
      );
      process.exitCode = 1;
    } finally {
      await db.$disconnect();
    }
  }
}
