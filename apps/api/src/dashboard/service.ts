import type { PrismaClient } from "../generated/prisma/client.js";
import { ApiError } from "../errors.js";
import { serializeTransaction } from "../transactions/service.js";
import type { SummaryQuery } from "./contracts.js";

type CategoryTotals = {
  categoryId: string;
  categoryName: string;
  incomeMinor: bigint;
  expensesMinor: bigint;
};

function safeMinor(value: bigint) {
  const bound = BigInt(Number.MAX_SAFE_INTEGER);
  if (value < -bound || value > bound)
    throw new ApiError(
      422,
      "SUMMARY_AMOUNT_OUT_OF_RANGE",
      "Summary amounts exceed the supported range. Choose a shorter period."
    );
  return Number(value);
}
function totals(income: bigint, expenses: bigint) {
  return {
    incomeMinor: safeMinor(income),
    expensesMinor: safeMinor(expenses),
    netMinor: safeMinor(income - expenses)
  };
}

export function createDashboardService(db: PrismaClient) {
  return {
    async summary(userId: string, query: SummaryQuery) {
      return db.$transaction(
        async (tx) => {
          // Tagged parameters remain data, never executable SQL. SUM(integer)
          // returns bigint; preserve exactness until the checked JSON boundary.
          const groups = await tx.$queryRaw<CategoryTotals[]>`
            SELECT t."categoryId", c.name AS "categoryName",
              COALESCE(SUM(t."amountMinor") FILTER (WHERE t.direction = 'income'), 0)::bigint AS "incomeMinor",
              COALESCE(SUM(t."amountMinor") FILTER (WHERE t.direction = 'expense'), 0)::bigint AS "expensesMinor"
            FROM "Transaction" t
            JOIN "Category" c ON c.id = t."categoryId" AND c."userId" = t."userId"
            WHERE t."userId" = ${userId}::uuid
              AND t.date >= ${query.from}::date AND t.date <= ${query.to}::date
              AND t.currency = ${query.currency}
            GROUP BY t."categoryId", c.name
            ORDER BY t."categoryId" ASC
          `;
          const recent = await tx.transaction.findMany({
            where: {
              userId,
              currency: query.currency,
              date: { gte: new Date(query.from), lte: new Date(query.to) }
            },
            orderBy: [{ date: "desc" }, { id: "desc" }],
            take: query.recentLimit
          });
          let income = 0n;
          let expenses = 0n;
          const categoryBreakdown = groups.map((group) => {
            income += group.incomeMinor;
            expenses += group.expensesMinor;
            return {
              categoryId: group.categoryId,
              categoryName: group.categoryName,
              ...totals(group.incomeMinor, group.expensesMinor)
            };
          });
          return {
            from: query.from,
            to: query.to,
            currency: query.currency,
            ...totals(income, expenses),
            categoryBreakdown,
            recentTransactions: recent.map(serializeTransaction)
          };
        },
        // Both reads see one snapshot even if another request edits/deletes rows.
        { isolationLevel: "RepeatableRead" }
      );
    }
  };
}
export type DashboardService = ReturnType<typeof createDashboardService>;
