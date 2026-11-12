import { Prisma, type PrismaClient } from "../generated/prisma/client.js";
import { ApiError } from "../errors.js";
import type { HistoryFilters, HistoryQuery, HistoryRow } from "./contracts.js";

const missing = () => new ApiError(404, "NOT_FOUND", "Resource not found.");
export const historyKey = (row: Pick<HistoryRow, "date" | "id" | "kind">) =>
  `${row.date}_${row.id}_${row.kind}`;
function safeNumber(value: bigint) {
  if (
    value > BigInt(Number.MAX_SAFE_INTEGER) ||
    value < -BigInt(Number.MAX_SAFE_INTEGER)
  )
    throw new ApiError(
      422,
      "SUMMARY_AMOUNT_OUT_OF_RANGE",
      "Daily totals exceed the supported range. Narrow the filters."
    );
  return Number(value);
}

// Both UNION arms scope financial rows and account joins to the owner. Shared
// categories only supply metadata; their visibility never grants ledger access.
function ledger(userId: string) {
  return Prisma.sql`WITH ledger AS NOT MATERIALIZED (
    SELECT 'transaction'::text AS kind, t.id, t.date, t.direction::text AS type,
      t."amountMinor", a.currency, t.note, a.id AS "accountId", a.name AS "accountName",
      NULL::uuid AS "toAccountId", NULL::text AS "toAccountName",
      c.id AS "categoryId", c.name AS "categoryName", p.id AS "parentCategoryId",
      p.name AS "parentCategoryName", c."iconKey"
    FROM "Transaction" t
    JOIN "Account" a ON a.id = t."accountId" AND a."userId" = t."userId"
    JOIN "Category" c ON c.id = t."categoryId" AND (c."userId" IS NULL OR c."userId" = t."userId")
    LEFT JOIN "Category" p ON p.id = c."parentId" AND (p."userId" IS NULL OR p."userId" = t."userId")
    WHERE t."userId" = ${userId}::uuid AND t."transferId" IS NULL
    UNION ALL
    SELECT 'transfer'::text, t.id, t.date, 'transfer'::text, t."amountMinor", a.currency, t.note,
      a.id, a.name, b.id, b.name, NULL::uuid, NULL::text, NULL::uuid, NULL::text, NULL::text
    FROM "Transfer" t
    JOIN "Account" a ON a.id = t."fromAccountId" AND a."userId" = t."userId"
    JOIN "Account" b ON b.id = t."toAccountId" AND b."userId" = t."userId"
    WHERE t."userId" = ${userId}::uuid
  )`;
}
const fields = Prisma.sql`kind, id, date::text AS date, type, "amountMinor", currency,
  note, "accountId", "accountName", "toAccountId", "toAccountName", "categoryId",
  "categoryName", "parentCategoryId", "parentCategoryName", "iconKey"`;
function conditions(filter: HistoryFilters) {
  const parts = [Prisma.sql`TRUE`];
  if (filter.from && filter.to)
    parts.push(
      Prisma.sql`date BETWEEN ${filter.from}::date AND ${filter.to}::date`
    );
  if (filter.accountId)
    parts.push(
      Prisma.sql`("accountId" = ${filter.accountId}::uuid OR "toAccountId" = ${filter.accountId}::uuid)`
    );
  if (filter.currency) parts.push(Prisma.sql`currency = ${filter.currency}`);
  if (filter.type) parts.push(Prisma.sql`type = ${filter.type}`);
  if (filter.categoryId)
    parts.push(
      filter.includeSubcategories
        ? Prisma.sql`("categoryId" = ${filter.categoryId}::uuid OR "parentCategoryId" = ${filter.categoryId}::uuid)`
        : Prisma.sql`"categoryId" = ${filter.categoryId}::uuid`
    );
  return Prisma.join(parts, " AND ");
}
function boundary(cursor: string) {
  return Prisma.sql`(${cursor.slice(0, 10)}::date, ${cursor.slice(11, 47)}::uuid, ${cursor.slice(48)})`;
}
export function revealFilters(filter: HistoryFilters, row: HistoryRow) {
  const applied = { ...filter },
    adjustments: string[] = [];
  if (
    applied.from &&
    applied.to &&
    (row.date < applied.from || row.date > applied.to)
  ) {
    // A single-day range always respects the maximum date-window contract.
    if (row.date < applied.from) applied.from = row.date;
    else applied.to = row.date;
    if (Date.parse(applied.to) - Date.parse(applied.from) > 366 * 86400000)
      applied.from = applied.to = row.date;
    adjustments.push("Date range adjusted to include the saved record.");
  }
  if (
    applied.accountId &&
    applied.accountId !== row.accountId &&
    applied.accountId !== row.toAccountId
  ) {
    delete applied.accountId;
    adjustments.push("Account filter cleared to show the saved record.");
  }
  if (applied.type && applied.type !== row.type) {
    delete applied.type;
    adjustments.push("Type filter cleared to show the saved record.");
  }
  if (
    applied.categoryId &&
    applied.categoryId !== row.categoryId &&
    !(
      applied.includeSubcategories &&
      applied.categoryId === row.parentCategoryId
    )
  ) {
    delete applied.categoryId;
    delete applied.includeSubcategories;
    adjustments.push("Category filter cleared to show the saved record.");
  }
  if (applied.currency && applied.currency !== row.currency) {
    delete applied.currency;
    adjustments.push("Currency filter cleared to show the saved record.");
  }
  return { applied, adjustments };
}

export function createHistoryService(db: PrismaClient) {
  return {
    async list(userId: string, query: HistoryQuery) {
      return db.$transaction(
        async (tx) => {
          // Validate selectors before relaxing a reveal filter: foreign private IDs
          // must never be accepted as an ordinary valid filter.
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
              where: {
                id: query.categoryId,
                OR: [{ userId: null }, { userId }]
              },
              select: { id: true }
            }))
          )
            throw missing();
          let applied: HistoryFilters = Object.fromEntries(
            Object.entries(query).filter(([key]) =>
              [
                "from",
                "to",
                "accountId",
                "currency",
                "type",
                "categoryId",
                "includeSubcategories"
              ].includes(key)
            )
          );
          let adjustments: string[] = [],
            focusedKey: string | null = null;
          if (query.focusId && query.focusKind) {
            const [row] = await tx.$queryRaw<
              HistoryRow[]
            >`${ledger(userId)} SELECT ${fields} FROM ledger WHERE id = ${query.focusId}::uuid AND kind = ${query.focusKind}`;
            if (!row) throw missing();
            ({ applied, adjustments } = revealFilters(applied, row));
            focusedKey = historyKey(row);
          }
          const match = conditions(applied);
          const position = query.after
            ? Prisma.sql`AND (date, id, kind) < ${boundary(query.after)}`
            : query.before
              ? Prisma.sql`AND (date, id, kind) > ${boundary(query.before)}`
              : focusedKey
                ? Prisma.sql`AND (date, id, kind) <= ${boundary(focusedKey)}`
                : Prisma.empty;
          const order = query.before ? Prisma.sql`ASC` : Prisma.sql`DESC`;
          const rows = await tx.$queryRaw<HistoryRow[]>`${ledger(userId)}
          SELECT ${fields} FROM ledger WHERE ${match} ${position}
          ORDER BY ledger.date ${order}, ledger.id ${order}, ledger.kind ${order} LIMIT ${query.limit}`;
          const items = query.before ? rows.reverse() : rows;
          const first = items[0],
            last = items.at(-1);
          if (!first || !last)
            return {
              items,
              days: [],
              nextCursor: null,
              previousCursor: null,
              applied,
              adjustments,
              focusedKey
            };
          const dates = [...new Set(items.map((row) => row.date))];
          type Day = {
            date: string;
            currency: HistoryRow["currency"];
            count: bigint;
            incomeMinor: bigint;
            expensesMinor: bigint;
          };
          const days = await tx.$queryRaw<Day[]>`${ledger(userId)}
          SELECT date::text AS date, currency, COUNT(*)::bigint AS count,
            COALESCE(SUM("amountMinor") FILTER (WHERE type = 'income'), 0)::bigint AS "incomeMinor",
            COALESCE(SUM("amountMinor") FILTER (WHERE type = 'expense'), 0)::bigint AS "expensesMinor"
          FROM ledger WHERE ${match} AND date IN (${Prisma.join(dates.map((date) => Prisma.sql`${date}::date`))})
          GROUP BY date, currency ORDER BY date DESC, currency ASC`;
          const [edges] = await tx.$queryRaw<
            { older: boolean; newer: boolean }[]
          >`${ledger(userId)}
          SELECT EXISTS(SELECT 1 FROM ledger WHERE ${match} AND (date, id, kind) < ${boundary(historyKey(last))}) AS older,
            EXISTS(SELECT 1 FROM ledger WHERE ${match} AND (date, id, kind) > ${boundary(historyKey(first))}) AS newer`;
          return {
            items,
            days: days.map((day) => ({
              ...day,
              count: safeNumber(day.count),
              incomeMinor: safeNumber(day.incomeMinor),
              expensesMinor: safeNumber(day.expensesMinor),
              netMinor: safeNumber(day.incomeMinor - day.expensesMinor)
            })),
            nextCursor: edges?.older ? historyKey(last) : null,
            previousCursor: edges?.newer ? historyKey(first) : null,
            applied,
            adjustments,
            focusedKey
          };
        },
        { isolationLevel: "RepeatableRead" }
      );
    }
  };
}
export type HistoryService = ReturnType<typeof createHistoryService>;
