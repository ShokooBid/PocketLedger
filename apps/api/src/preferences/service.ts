import type {
  Prisma,
  PrismaClient,
  FinancePreferences
} from "../generated/prisma/client.js";
import { ApiError } from "../errors.js";
import {
  currencySchema,
  type TransactionInput
} from "../transactions/contracts.js";

type Tx = Prisma.TransactionClient;
const serialize = (row: FinancePreferences) => ({
  entryCurrency: currencySchema.parse(row.entryCurrency),
  currencyLocked: row.currencyLockedAt !== null,
  defaultAccountId: null
});

export async function lockFinanceOwner(tx: Tx, userId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "User" WHERE id = ${userId}::uuid FOR UPDATE
  `;
  if (!rows.length) throw new ApiError(404, "NOT_FOUND", "Resource not found.");
}

// Caller holds the owner lock. No legacy inference/mixed-currency migration:
// the user chose fresh test ledgers for this gated increment.
async function activate(tx: Tx, userId: string) {
  const existing = await tx.financePreferences.findUnique({
    where: { userId }
  });
  if (existing) return existing;
  const incompatible = await tx.transaction.findFirst({
    where: { userId, currency: { not: "CAD" } },
    select: { id: true }
  });
  if (incompatible)
    throw new ApiError(
      409,
      "CURRENCY_SETUP_REQUIRED",
      "Use a fresh test ledger before enabling currency settings."
    );
  const first = await tx.transaction.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true }
  });
  return tx.financePreferences.create({
    data: {
      userId,
      entryCurrency: "CAD",
      currencyLockedAt: first?.createdAt ?? null
    }
  });
}

export async function assertNewTransactionCurrency(
  tx: Tx,
  userId: string,
  currency: TransactionInput["currency"],
  activateFlow: boolean
) {
  await lockFinanceOwner(tx, userId);
  const row = activateFlow
    ? await activate(tx, userId)
    : await tx.financePreferences.findUnique({ where: { userId } });
  if (row && row.entryCurrency !== currency)
    throw new ApiError(
      422,
      "CURRENCY_MISMATCH",
      "Choose the configured currency in Settings."
    );
}

export function createPreferencesService(db: PrismaClient, enabled: boolean) {
  function available() {
    if (!enabled)
      throw new ApiError(
        409,
        "FINANCE_FEATURE_DISABLED",
        "Currency settings are not enabled in this release."
      );
  }
  return {
    async get(userId: string) {
      available();
      return db.$transaction(async (tx) => {
        await lockFinanceOwner(tx, userId);
        return serialize(await activate(tx, userId));
      });
    },
    async update(userId: string, entryCurrency: TransactionInput["currency"]) {
      available();
      return db.$transaction(async (tx) => {
        await lockFinanceOwner(tx, userId);
        const row = await activate(tx, userId);
        if (row.entryCurrency === entryCurrency) return serialize(row);
        if (row.currencyLockedAt)
          throw new ApiError(
            409,
            "CURRENCY_LOCKED",
            "Currency is locked after the first saved transaction."
          );
        return serialize(
          await tx.financePreferences.update({
            where: { userId },
            data: { entryCurrency }
          })
        );
      });
    }
  };
}
export type PreferencesService = ReturnType<typeof createPreferencesService>;
