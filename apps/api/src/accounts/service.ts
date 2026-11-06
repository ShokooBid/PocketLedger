import type {
  Account,
  Prisma,
  PrismaClient
} from "../generated/prisma/client.js";
import { ApiError } from "../errors.js";
import { currencySchema } from "../transactions/contracts.js";
import {
  ensureFinancePreferences,
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

export function createAccountService(db: PrismaClient) {
  async function write<T>(
    userId: string,
    action: (tx: Prisma.TransactionClient) => Promise<T>
  ) {
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
      return db.$transaction(
        async (tx) => {
          const row = serialize(await owned(tx, userId, id));
          if (asOf < row.openingDate)
            throw new ApiError(
              422,
              "INVALID_ACCOUNT",
              "The balance date cannot precede the account opening date."
            );
          const [total] = await tx.$queryRaw<{ postings: string }[]>`
        SELECT COALESCE(SUM(CASE WHEN direction = 'income' THEN "amountMinor"::numeric
          ELSE -"amountMinor"::numeric END), 0)::text AS postings
        FROM "Transaction" WHERE "userId" = ${userId}::uuid AND "accountId" = ${id}::uuid
          AND currency = ${row.currency} AND date <= ${asOf}::date
      `;
          const balance =
            BigInt(row.openingBalanceMinor) + BigInt(total!.postings);
          const bound = BigInt(Number.MAX_SAFE_INTEGER);
          if (balance < -bound || balance > bound)
            throw new ApiError(
              422,
              "SUMMARY_AMOUNT_OUT_OF_RANGE",
              "The account balance exceeds the supported integer range."
            );
          return { ...row, asOf, balanceMinor: Number(balance) };
        },
        { isolationLevel: "RepeatableRead" }
      );
    },
    create(userId: string, input: AccountInput) {
      return write(userId, async (tx) => {
        const preference = await ensureFinancePreferences(tx, userId);
        if (preference.entryCurrency === null)
          throw new ApiError(
            409,
            "CURRENCY_REQUIRED",
            "Choose your permanent currency before creating an account."
          );
        if (preference.entryCurrency !== input.currency)
          throw new ApiError(
            409,
            "PREFERENCE_CHANGED",
            "The account must use your permanent currency."
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
