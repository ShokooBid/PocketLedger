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
async function snapshot(tx: Tx, row: FinancePreferences) {
  const active = await tx.account.findFirst({
    where: { userId: row.userId, archivedAt: null },
    select: { id: true }
  });
  return {
    entryCurrency: currencySchema.nullable().parse(row.entryCurrency),
    hasActiveAccounts: active !== null,
    defaultAccountId: row.defaultAccountId
  };
}

export async function lockFinanceOwner(tx: Tx, userId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "User" WHERE id = ${userId}::uuid FOR UPDATE
  `;
  if (!rows.length) throw new ApiError(404, "NOT_FOUND", "Resource not found.");
}

// Caller holds the owner lock. Creating the preference row never chooses money's
// currency: null means the user still needs to confirm their permanent choice.
export async function ensureFinancePreferences(tx: Tx, userId: string) {
  const existing = await tx.financePreferences.findUnique({
    where: { userId }
  });
  if (existing) return existing;
  return tx.financePreferences.create({
    data: { userId }
  });
}

export async function assertNewTransactionCurrency(
  tx: Tx,
  userId: string,
  currency: TransactionInput["currency"]
) {
  const row = await ensureFinancePreferences(tx, userId);
  if (row.entryCurrency === null)
    throw new ApiError(
      409,
      "CURRENCY_REQUIRED",
      "Choose your permanent currency first."
    );
  if (row.entryCurrency !== currency)
    throw new ApiError(
      422,
      "CURRENCY_MISMATCH",
      "Use your permanent currency."
    );
}

export function createPreferencesService(db: PrismaClient) {
  return {
    async get(userId: string) {
      return db.$transaction(async (tx) => {
        await lockFinanceOwner(tx, userId);
        return snapshot(tx, await ensureFinancePreferences(tx, userId));
      });
    },
    async update(userId: string, patch: PreferencesPatch) {
      return db.$transaction(async (tx) => {
        await lockFinanceOwner(tx, userId);
        const row = await ensureFinancePreferences(tx, userId);
        const entryCurrency = patch.entryCurrency ?? row.entryCurrency;
        if (row.entryCurrency !== null && row.entryCurrency !== entryCurrency)
          throw new ApiError(
            409,
            "CURRENCY_LOCKED",
            "Your currency cannot change after it has been chosen."
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
          return snapshot(tx, row);
        return snapshot(
          tx,
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
