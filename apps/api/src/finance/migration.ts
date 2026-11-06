import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { ApiError } from "../errors.js";
import { lockFinanceOwner } from "../preferences/service.js";
import { currencySchema } from "../transactions/contracts.js";

// Offline support for the preserved expansion migration only. The application
// does not import this module or depend on a rollout phase.
type FinancePhase = "legacy" | "upgrading" | "v2";
export async function financeMigrationStatus(tx: Prisma.TransactionClient) {
  const [table] = await tx.$queryRaw<
    { present: boolean }[]
  >`SELECT to_regclass('"FinanceRollout"') IS NOT NULL AS present`;
  if (!table!.present) return "complete" as const;
  const [row] = await tx.$queryRaw<
    { phase: FinancePhase }[]
  >`SELECT phase FROM "FinanceRollout" WHERE id = 1`;
  return row!.phase;
}
async function requireBackfillWindow(tx: Prisma.TransactionClient) {
  const [row] = await tx.$queryRaw<
    { phase: FinancePhase }[]
  >`SELECT phase FROM "FinanceRollout" WHERE id = 1 FOR SHARE`;
  if (row?.phase !== "upgrading")
    throw new ApiError(
      409,
      "MIGRATION_NOT_PREPARED",
      "Prepare the offline backfill first."
    );
}

type Group = {
  currency: string;
  earliest: string;
  unlinked: bigint;
};

async function snapshot(tx: Prisma.TransactionClient, userId: string) {
  // Preserve every existing field (including audit times, merchant and importId).
  // The digest never leaves this function's caller and contains no raw text.
  const [row] = await tx.$queryRaw<{ digest: string }[]>`
    SELECT md5(COALESCE(jsonb_agg(to_jsonb(t) - 'accountId' ORDER BY id)::text, '[]')) AS digest
    FROM "Transaction" t WHERE "userId" = ${userId}::uuid
  `;
  return row!.digest;
}

export async function prepareFinanceUpgrade(db: PrismaClient) {
  return db.$transaction(
    async (tx) => {
      if ((await financeMigrationStatus(tx)) === "complete") return "complete";
      const [row] = await tx.$queryRaw<{ phase: FinancePhase }[]>`
      SELECT phase FROM "FinanceRollout" WHERE id = 1 FOR UPDATE
    `;
      if (row?.phase === "legacy")
        await tx.$executeRaw`UPDATE "FinanceRollout" SET phase = 'upgrading' WHERE id = 1`;
      return row?.phase === "legacy" ? "upgrading" : row?.phase;
    },
    { timeout: 60_000 }
  );
}

// One owner per atomic unit, making interruption/retry bounded and reviewable.
// Preview works in legacy; applying requires the persisted upgrading gate.
export async function backfillFinanceOwner(
  db: PrismaClient,
  userId: string,
  options: {
    apply: boolean;
    entryCurrency?: string;
  }
) {
  return db.$transaction(
    async (tx) => {
      if (options.apply) await requireBackfillWindow(tx);
      await lockFinanceOwner(tx, userId);
      const groups = await tx.$queryRaw<Group[]>`
      SELECT currency,
        to_char(min(date), 'YYYY-MM-DD') AS earliest,
        count(*) FILTER (WHERE "accountId" IS NULL)::bigint AS unlinked
      FROM "Transaction" WHERE "userId" = ${userId}::uuid GROUP BY currency ORDER BY currency
    `;
      const preference = await tx.financePreferences.findUnique({
        where: { userId }
      });
      const conflicts: string[] = [];
      if (groups.some((g) => !currencySchema.safeParse(g.currency).success))
        conflicts.push("UNSUPPORTED_HISTORICAL_CURRENCY");
      if (
        options.entryCurrency &&
        !currencySchema.safeParse(options.entryCurrency).success
      )
        conflicts.push("INVALID_CURRENCY_CHOICE");
      if (
        preference &&
        options.entryCurrency &&
        preference.entryCurrency !== options.entryCurrency
      )
        conflicts.push("EXPLICIT_PREFERENCE_MUST_BE_PRESERVED");
      if (!preference && groups.length > 1 && !options.entryCurrency)
        conflicts.push("EXPLICIT_CURRENCY_CHOICE_REQUIRED");
      const selected =
        preference?.entryCurrency ??
        options.entryCurrency ??
        groups[0]?.currency ??
        "CAD";
      const assignments: {
        currency: string;
        accountId: string | null;
        openingDate: string;
        count: string;
      }[] = [];
      for (const group of groups.filter((g) => g.unlinked > 0n)) {
        const account = await tx.account.findUnique({
          where: {
            userId_legacyCurrency: { userId, legacyCurrency: group.currency }
          }
        });
        if (
          account &&
          (account.archivedAt ||
            account.openingBalanceMinor !== 0 ||
            account.openingDate.toISOString().slice(0, 10) > group.earliest)
        )
          conflicts.push("LEGACY_ACCOUNT_REQUIRES_REVIEW");
        const name = `Unassigned (${group.currency})`;
        const collision = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "Account" WHERE "userId" = ${userId}::uuid AND "archivedAt" IS NULL
          AND translate(btrim(regexp_replace(name, E'[ \\t\\n\\r\\f' || chr(11) || ']+', ' ', 'g')),
            'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') COLLATE "C" = lower(${name}) COLLATE "C"
      `;
        if (!account && collision.length)
          conflicts.push("UNASSIGNED_NAME_CONFLICT");
        assignments.push({
          currency: group.currency,
          accountId: account?.id ?? null,
          openingDate: group.earliest,
          count: String(group.unlinked)
        });
      }
      const result = {
        userId,
        currencies: groups.map((g) => g.currency),
        entryCurrency: selected,
        assignments,
        conflicts
      };
      if (!options.apply || conflicts.length) return result;

      const before = await snapshot(tx, userId);
      // Preserve explicit settings; otherwise infer only unambiguous history or use
      // the owner's explicit mixed-history choice. Never relabel recorded money.
      if (!preference)
        await tx.financePreferences.create({
          data: {
            userId,
            entryCurrency: selected
          }
        });
      // This offline tool targets the old expansion schema only. Use SQL for
      // its retired column; the generated current Prisma model no longer has it.
      // Issue #94 removes this legacy tool altogether.
      if (groups.length)
        await tx.$executeRaw`UPDATE "FinancePreferences"
          SET "currencyLockedAt" = COALESCE("currencyLockedAt", CURRENT_TIMESTAMP)
          WHERE "userId" = ${userId}::uuid`;

      for (const assignment of assignments) {
        const accountId =
          assignment.accountId ??
          (
            await tx.account.create({
              data: {
                userId,
                name: `Unassigned (${assignment.currency})`,
                type: "other",
                currency: assignment.currency,
                legacyCurrency: assignment.currency,
                openingBalanceMinor: 0,
                openingDate: new Date(assignment.openingDate)
              }
            })
          ).id;
        // Raw SQL is intentional: Prisma @updatedAt would alter legacy audit times.
        await tx.$executeRaw`UPDATE "Transaction" SET "accountId" = ${accountId}::uuid
        WHERE "userId" = ${userId}::uuid AND currency = ${assignment.currency} AND "accountId" IS NULL`;
        assignment.accountId = accountId;
      }
      if (before !== (await snapshot(tx, userId)))
        throw new ApiError(
          409,
          "MIGRATION_VERIFICATION_FAILED",
          "Historical data changed; this owner backfill was rolled back."
        );
      return result;
    },
    { timeout: 60_000 }
  );
}

export async function verifyFinanceMigration(db: PrismaClient) {
  return db.$transaction(
    async (tx) => {
      const [invalid] = await tx.$queryRaw<{ count: bigint }[]>`
      SELECT count(*)::bigint AS count FROM "Transaction" t
      LEFT JOIN "Account" a ON a.id = t."accountId" AND a."userId" = t."userId" AND a.currency = t.currency
      LEFT JOIN "FinancePreferences" p ON p."userId" = t."userId"
      WHERE a.id IS NULL OR t.date < a."openingDate" OR p."currencyLockedAt" IS NULL
    `;
      if (invalid!.count > 0n)
        throw new ApiError(
          409,
          "MIGRATION_VERIFICATION_FAILED",
          "Resolve all unassigned or invalid postings before deploying the canonical schema."
        );
      return "verified";
    },
    { timeout: 60_000 }
  );
}
