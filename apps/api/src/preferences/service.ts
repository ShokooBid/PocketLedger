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
import type { PreferencesPatch } from "./contracts.js";

type Tx = Prisma.TransactionClient;
const serialize = (row: FinancePreferences) => ({
  entryCurrency: currencySchema.parse(row.entryCurrency),
  currencyLocked: row.currencyLockedAt !== null,
  defaultAccountId: row.defaultAccountId
});

export async function lockFinanceOwner(tx: Tx, userId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "User" WHERE id = ${userId}::uuid FOR UPDATE
  `;
  if (!rows.length) throw new ApiError(404, "NOT_FOUND", "Resource not found.");
}

// Caller holds the owner lock. No legacy inference/mixed-currency migration:
// the user chose fresh test ledgers for this gated increment.
export async function activateFinancePreferences(tx: Tx, userId: string) {
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
    ? await activateFinancePreferences(tx, userId)
    : await tx.financePreferences.findUnique({ where: { userId } });
  if (row && row.entryCurrency !== currency)
    throw new ApiError(
      422,
      "CURRENCY_MISMATCH",
      "Choose the configured currency in Settings."
    );
}

export function createPreferencesService(
  db: PrismaClient,
  enabled: boolean,
  accountsEnabled = false
) {
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
        return serialize(await activateFinancePreferences(tx, userId));
      });
    },
    async update(userId: string, patch: PreferencesPatch) {
      available();
      if (patch.defaultAccountId !== undefined && !accountsEnabled)
        throw new ApiError(
          409,
          "FINANCE_FEATURE_DISABLED",
          "Financial accounts are not enabled in this release."
        );
      return db.$transaction(async (tx) => {
        await lockFinanceOwner(tx, userId);
        const row = await activateFinancePreferences(tx, userId);
        const entryCurrency =
          patch.entryCurrency ?? currencySchema.parse(row.entryCurrency);
        if (row.entryCurrency !== entryCurrency && row.currencyLockedAt)
          throw new ApiError(
            409,
            "CURRENCY_LOCKED",
            "Currency is locked after the first saved transaction."
          );
        let defaultAccountId =
          patch.defaultAccountId === undefined
            ? row.defaultAccountId
            : patch.defaultAccountId;
        if (defaultAccountId !== null) {
          const account = await tx.account.findFirst({
            where: { id: defaultAccountId, userId }
          });
          if (!account)
            throw new ApiError(404, "NOT_FOUND", "Resource not found.");
          if (account.archivedAt || account.currency !== entryCurrency) {
            if (patch.defaultAccountId !== undefined)
              throw new ApiError(
                422,
                "INVALID_ACCOUNT",
                "Choose an active account in the configured currency."
              );
            defaultAccountId = null;
          }
        }
        if (
          row.entryCurrency === entryCurrency &&
          row.defaultAccountId === defaultAccountId
        )
          return serialize(row);
        return serialize(
          await tx.financePreferences.update({
            where: { userId },
            data: { entryCurrency, defaultAccountId }
          })
        );
      });
    }
  };
}
export type PreferencesService = ReturnType<typeof createPreferencesService>;
