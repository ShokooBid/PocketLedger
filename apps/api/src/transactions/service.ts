import type {
  PrismaClient,
  Transaction,
  Prisma
} from "../generated/prisma/client.js";
import { ApiError } from "../errors.js";
import type {
  TransactionInput,
  TransactionPatch,
  TransactionQuery
} from "./contracts.js";
import { currencySchema } from "./contracts.js";

const unavailable = () => new ApiError(404, "NOT_FOUND", "Resource not found.");
const invalidCategory = () =>
  new ApiError(
    422,
    "INVALID_CATEGORY",
    "Choose an active category belonging to your account."
  );
const serialize = (row: Transaction) => ({
  id: row.id,
  categoryId: row.categoryId,
  direction: row.direction,
  amountMinor: row.amountMinor,
  currency: currencySchema.parse(row.currency),
  date: row.date.toISOString().slice(0, 10),
  merchant: row.merchant,
  note: row.note,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString()
});
async function checkCategory(
  tx: Prisma.TransactionClient,
  userId: string,
  id: string
) {
  // Share lock serializes new assignments with category archival. The existing
  // DB trigger is a second guard for writes outside this service.
  const rows = await tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM "Category" WHERE id = ${id}::uuid AND "userId" = ${userId}::uuid AND "archivedAt" IS NULL FOR SHARE`;
  if (!rows.length) throw invalidCategory();
}
export function createTransactionService(db: PrismaClient) {
  return {
    async list(userId: string, query: TransactionQuery) {
      const boundary = query.after
        ? {
            date: new Date(query.after.slice(0, 10)),
            id: query.after.slice(11)
          }
        : null;
      const rows = await db.transaction.findMany({
        where: {
          userId,
          ...(query.categoryId ? { categoryId: query.categoryId } : {}),
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
        take: query.limit + 1
      });
      const items = rows.slice(0, query.limit).map(serialize);
      const last = items.at(-1);
      return {
        items,
        nextCursor:
          rows.length > query.limit && last ? `${last.date}_${last.id}` : null
      };
    },
    async get(userId: string, id: string) {
      const row = await db.transaction.findFirst({ where: { id, userId } });
      if (!row) throw unavailable();
      return serialize(row);
    },
    async create(userId: string, input: TransactionInput) {
      return db.$transaction(async (tx) => {
        await checkCategory(tx, userId, input.categoryId);
        return serialize(
          await tx.transaction.create({
            data: { ...input, userId, date: new Date(input.date) }
          })
        );
      });
    },
    async update(userId: string, id: string, input: TransactionPatch) {
      return db.$transaction(async (tx) => {
        // Lock the owned row before comparing historical category associations.
        const rows = await tx.$queryRaw<
          { categoryId: string }[]
        >`SELECT "categoryId" FROM "Transaction" WHERE id = ${id}::uuid AND "userId" = ${userId}::uuid FOR UPDATE`;
        const row = rows[0];
        if (!row) throw unavailable();
        if (input.categoryId && input.categoryId !== row.categoryId)
          await checkCategory(tx, userId, input.categoryId);
        const data: Prisma.TransactionUncheckedUpdateInput = {
          ...(input.direction !== undefined
            ? { direction: input.direction }
            : {}),
          ...(input.amountMinor !== undefined
            ? { amountMinor: input.amountMinor }
            : {}),
          ...(input.currency !== undefined ? { currency: input.currency } : {}),
          ...(input.categoryId !== undefined
            ? { categoryId: input.categoryId }
            : {}),
          ...(input.merchant !== undefined ? { merchant: input.merchant } : {}),
          ...(input.note !== undefined ? { note: input.note } : {}),
          ...(input.date !== undefined ? { date: new Date(input.date) } : {})
        };
        return serialize(
          await tx.transaction.update({ where: { id, userId }, data })
        );
      });
    },
    async remove(userId: string, id: string) {
      const result = await db.transaction.deleteMany({ where: { id, userId } });
      if (!result.count) throw unavailable();
      return { ok: true as const };
    }
  };
}
export type TransactionService = ReturnType<typeof createTransactionService>;
