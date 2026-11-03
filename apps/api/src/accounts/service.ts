import type {
  Account,
  Prisma,
  PrismaClient
} from "../generated/prisma/client.js";
import { ApiError } from "../errors.js";
import { currencySchema } from "../transactions/contracts.js";
import {
  activateFinancePreferences,
  lockFinanceOwner
} from "../preferences/service.js";
import type { AccountInput, AccountPatch, AccountQuery } from "./contracts.js";

const missing = () => new ApiError(404, "NOT_FOUND", "Resource not found.");
const serialize = (row: Account) => ({
  id: row.id,
  name: row.name,
  type: row.type,
  currency: currencySchema.parse(row.currency),
  openingBalanceMinor: row.openingBalanceMinor,
  openingDate: row.openingDate.toISOString().slice(0, 10),
  archivedAt: row.archivedAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString()
});
async function owned(tx: Prisma.TransactionClient, userId: string, id: string) {
  const row = await tx.account.findFirst({ where: { id, userId } });
  if (!row) throw missing();
  return row;
}

export function createAccountService(db: PrismaClient, enabled = false) {
  function available() {
    if (!enabled)
      throw new ApiError(
        409,
        "FINANCE_FEATURE_DISABLED",
        "Financial accounts are not enabled in this release."
      );
  }
  async function write<T>(
    userId: string,
    action: (tx: Prisma.TransactionClient) => Promise<T>
  ) {
    available();
    try {
      return await db.$transaction(async (tx) => {
        await lockFinanceOwner(tx, userId);
        return action(tx);
      });
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "P2002"
      )
        throw new ApiError(
          409,
          "ACCOUNT_NAME_CONFLICT",
          "An active account already uses this name."
        );
      throw error;
    }
  }
  return {
    async list(userId: string, query: AccountQuery) {
      available();
      const rows = await db.account.findMany({
        where: {
          userId,
          ...(query.status === "active"
            ? { archivedAt: null }
            : query.status === "archived"
              ? { archivedAt: { not: null } }
              : {}),
          ...(query.after ? { id: { gt: query.after } } : {})
        },
        orderBy: { id: "asc" },
        take: query.limit + 1
      });
      const items = rows.slice(0, query.limit).map(serialize);
      return {
        items,
        nextCursor: rows.length > query.limit ? items.at(-1)!.id : null
      };
    },
    async get(
      userId: string,
      id: string,
      asOf = new Date().toISOString().slice(0, 10)
    ) {
      available();
      const row = serialize(await owned(db, userId, id));
      if (asOf < row.openingDate)
        throw new ApiError(
          422,
          "INVALID_ACCOUNT",
          "The balance date cannot precede the account opening date."
        );
      // #69 adds transaction/account linkage and the exact posting aggregation.
      // No posting can reference an account yet, so its tracked balance is its
      // opening baseline. Never attribute unassigned legacy history to it.
      return { ...row, asOf, balanceMinor: row.openingBalanceMinor };
    },
    create(userId: string, input: AccountInput) {
      return write(userId, async (tx) => {
        const preference = await activateFinancePreferences(tx, userId);
        if (preference.entryCurrency !== input.currency)
          throw new ApiError(
            409,
            "PREFERENCE_CHANGED",
            "Currency settings changed. Reload Settings before creating the account."
          );
        return serialize(
          await tx.account.create({
            data: {
              userId,
              name: input.name,
              type: input.type,
              currency: preference.entryCurrency,
              openingBalanceMinor: input.openingBalanceMinor,
              openingDate: new Date(`${input.openingDate}T00:00:00.000Z`)
            }
          })
        );
      });
    },
    update(userId: string, id: string, input: AccountPatch) {
      return write(userId, async (tx) => {
        const row = await owned(tx, userId, id);
        if (row.archivedAt)
          throw new ApiError(
            409,
            "ACCOUNT_ARCHIVED",
            "Archived accounts cannot be changed."
          );
        return serialize(
          await tx.account.update({
            where: { id, userId },
            data: {
              ...(input.name !== undefined ? { name: input.name } : {}),
              ...(input.type !== undefined ? { type: input.type } : {})
            }
          })
        );
      });
    },
    archive(userId: string, id: string) {
      return write(userId, async (tx) => {
        const row = await owned(tx, userId, id);
        // The DB trigger clears any matching default in this transaction too.
        return serialize(
          row.archivedAt
            ? row
            : await tx.account.update({
                where: { id, userId },
                data: { archivedAt: new Date() }
              })
        );
      });
    }
  };
}
export type AccountService = ReturnType<typeof createAccountService>;
