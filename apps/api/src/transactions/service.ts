import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { ApiError } from "../errors.js";
import {
  assertNewTransactionCurrency,
  lockFinanceOwner
} from "../preferences/service.js";
import { currencySchema, transactionCreate } from "./contracts.js";
import type {
  TransactionCreate,
  TransactionInput,
  TransactionPatch,
  TransactionQuery
} from "./contracts.js";

const missing = () => new ApiError(404, "NOT_FOUND", "Resource not found.");
// Hash creation intent, never the mutable current resource or JSON key order.
export function transactionCreationFingerprint(input: TransactionInput) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        input.accountId.toLowerCase(),
        input.categoryId.toLowerCase(),
        input.direction,
        input.amountMinor,
        input.date,
        input.note || null
      ])
    )
    .digest("hex");
}
const withAccountCurrency = {
  account: { select: { currency: true } }
} as const;
type TransactionWithAccount = Prisma.TransactionGetPayload<{
  include: typeof withAccountCurrency;
}>;
export function serializeTransaction(row: TransactionWithAccount) {
  return {
    id: row.id,
    accountId: row.accountId,
    categoryId: row.categoryId,
    direction: row.direction,
    amountMinor: row.amountMinor,
    currency: currencySchema.parse(row.account.currency),
    date: row.date.toISOString().slice(0, 10),
    note: row.note,
    importId: row.importId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}
async function checkCategory(
  tx: Prisma.TransactionClient,
  userId: string,
  id: string
) {
  const category = await tx.category.findFirst({
    where: { id, userId },
    include: { parent: true }
  });
  if (!category) throw missing();
  if (category.archivedAt || category.parent?.archivedAt)
    throw new ApiError(
      422,
      "INVALID_CATEGORY",
      "Choose an active category and ancestor."
    );
}
async function checkAccount(
  tx: Prisma.TransactionClient,
  userId: string,
  id: string,
  date: string,
  previous?: TransactionWithAccount
) {
  const account = await tx.account.findFirst({ where: { id, userId } });
  if (!account) throw missing();
  if (
    (account.archivedAt && account.id !== previous?.accountId) ||
    date < account.openingDate.toISOString().slice(0, 10)
  )
    throw new ApiError(
      422,
      "INVALID_ACCOUNT",
      "Choose an active account and a date on or after its opening date."
    );
  if (previous && account.currency !== previous.account.currency)
    throw new ApiError(
      422,
      "CURRENCY_MISMATCH",
      "Choose an account in the original account currency; amounts cannot be converted."
    );
  return account;
}
export function createTransactionService(db: PrismaClient) {
  const run = <T>(action: (tx: Prisma.TransactionClient) => Promise<T>) =>
    db.$transaction(action);
  return {
    list(userId: string, query: TransactionQuery) {
      return run(async (tx) => {
        if (
          query.accountId &&
          !(await tx.account.findFirst({
            where: { id: query.accountId, userId },
            select: { id: true }
          }))
        )
          throw missing();
        if (
          query.categoryId &&
          !(await tx.category.findFirst({
            where: { id: query.categoryId, userId },
            select: { id: true }
          }))
        )
          throw missing();
        const boundary = query.after
          ? {
              date: new Date(query.after.slice(0, 10)),
              id: query.after.slice(11)
            }
          : null;
        const rows = await tx.transaction.findMany({
          where: {
            userId,
            ...(query.accountId ? { accountId: query.accountId } : {}),
            ...(query.currency
              ? { account: { currency: query.currency } }
              : {}),
            ...(query.categoryId
              ? query.includeSubcategories
                ? {
                    category: {
                      userId,
                      OR: [
                        { id: query.categoryId },
                        { parentId: query.categoryId }
                      ]
                    }
                  }
                : { categoryId: query.categoryId }
              : {}),
            ...(query.direction ? { direction: query.direction } : {}),
            ...(query.from && query.to
              ? { date: { gte: new Date(query.from), lte: new Date(query.to) } }
              : {}),
            ...(boundary
              ? {
                  OR: [
                    { date: { lt: boundary.date } },
                    { date: boundary.date, id: { lt: boundary.id } }
                  ]
                }
              : {})
          },
          orderBy: [{ date: "desc" }, { id: "desc" }],
          take: query.limit + 1,
          include: withAccountCurrency
        });
        const items = rows.slice(0, query.limit).map(serializeTransaction),
          last = items.at(-1);
        return {
          items,
          nextCursor:
            rows.length > query.limit && last ? `${last.date}_${last.id}` : null
        };
      });
    },
    get(userId: string, id: string) {
      return run(async (tx) => {
        const row = await tx.transaction.findFirst({
          where: { id, userId },
          include: withAccountCurrency
        });
        if (!row) throw missing();
        return serializeTransaction(row);
      });
    },
    create(userId: string, input: TransactionCreate) {
      const { clientRequestId, ...fields } = transactionCreate.parse(input);
      const payload = { ...fields, note: fields.note || null };
      const creationFingerprint = transactionCreationFingerprint(payload);
      return run(async (tx) => {
        await lockFinanceOwner(tx, userId);
        const prior = await tx.transaction.findUnique({
          where: { userId_clientRequestId: { userId, clientRequestId } },
          include: withAccountCurrency
        });
        if (prior) {
          if (prior.creationFingerprint !== creationFingerprint)
            throw new ApiError(
              409,
              "IDEMPOTENCY_KEY_REUSED",
              "This creation key already belongs to a different payload."
            );
          return { resource: serializeTransaction(prior), replayed: true };
        }
        await checkCategory(tx, userId, payload.categoryId);
        const account = await checkAccount(
          tx,
          userId,
          payload.accountId,
          payload.date
        );
        await assertNewTransactionCurrency(tx, userId, account.currency);
        const row = await tx.transaction.create({
          data: {
            ...payload,
            userId,
            clientRequestId,
            creationFingerprint,
            date: new Date(payload.date),
            merchant: null
          },
          include: withAccountCurrency
        });
        return { resource: serializeTransaction(row), replayed: false };
      });
    },
    update(userId: string, id: string, patch: TransactionPatch) {
      return run(async (tx) => {
        await lockFinanceOwner(tx, userId);
        const row = await tx.transaction.findFirst({
          where: { id, userId },
          include: withAccountCurrency
        });
        if (!row) throw missing();
        const accountId = patch.accountId ?? row.accountId;
        const date = patch.date ?? row.date.toISOString().slice(0, 10);
        await checkAccount(tx, userId, accountId, date, row);
        if (
          patch.categoryId &&
          patch.categoryId.toLowerCase() !== row.categoryId
        )
          await checkCategory(tx, userId, patch.categoryId);
        return serializeTransaction(
          await tx.transaction.update({
            where: { id, userId },
            data: {
              ...(patch.accountId !== undefined
                ? { accountId: patch.accountId }
                : {}),
              ...(patch.categoryId !== undefined
                ? { categoryId: patch.categoryId }
                : {}),
              ...(patch.direction !== undefined
                ? { direction: patch.direction }
                : {}),
              ...(patch.amountMinor !== undefined
                ? { amountMinor: patch.amountMinor }
                : {}),
              ...(patch.note !== undefined ? { note: patch.note || null } : {}),
              ...(patch.date !== undefined
                ? { date: new Date(patch.date) }
                : {})
            },
            include: withAccountCurrency
          })
        );
      });
    },
    remove(userId: string, id: string) {
      return run(async (tx) => {
        await lockFinanceOwner(tx, userId);
        const result = await tx.transaction.deleteMany({
          where: { id, userId }
        });
        if (!result.count) throw missing();
        return { ok: true as const };
      });
    }
  };
}
export type TransactionService = ReturnType<typeof createTransactionService>;
