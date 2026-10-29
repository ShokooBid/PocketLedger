import { z } from "zod";
import { ClientFailure, type Transport } from "./auth/transport";
import type { CategorySource } from "./category-data";
import { appendTransactionPage } from "./transaction-history";
import {
  amountText,
  calendarDate,
  currencySchema,
  transactionSchema,
  type Currency,
  type Transaction,
  type TransactionSource
} from "./transaction-data";

export const monthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
  .refine((month) => month >= "0001-01");
export type DashboardSelection = { month: string; currency: Currency };
const totalFields = {
  incomeMinor: z.number().int().nonnegative(),
  expensesMinor: z.number().int().nonnegative(),
  netMinor: z.number().int()
};
export const dashboardSchema = z
  .object({
    from: calendarDate,
    to: calendarDate,
    currency: currencySchema,
    ...totalFields,
    categoryBreakdown: z.array(
      z.object({
        categoryId: z.uuid(),
        categoryName: z.string(),
        ...totalFields
      })
    ),
    recentTransactions: z.array(transactionSchema).max(5)
  })
  .refine((summary) => {
    const groups = summary.categoryBreakdown;
    return (
      BigInt(summary.netMinor) ===
        BigInt(summary.incomeMinor) - BigInt(summary.expensesMinor) &&
      groups.every(
        (group) =>
          BigInt(group.netMinor) ===
          BigInt(group.incomeMinor) - BigInt(group.expensesMinor)
      ) &&
      groups.reduce((sum, group) => sum + BigInt(group.incomeMinor), 0n) ===
        BigInt(summary.incomeMinor) &&
      groups.reduce((sum, group) => sum + BigInt(group.expensesMinor), 0n) ===
        BigInt(summary.expensesMinor)
    );
  });
export type DashboardSummary = z.infer<typeof dashboardSchema>;
export interface DashboardSource {
  summary(selection: DashboardSelection): Promise<DashboardSummary>;
  subscribe(listener: () => void): () => void;
}

export function currentMonth(now = new Date()) {
  return `${String(now.getFullYear()).padStart(4, "0")}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}
export function monthRange(month: string) {
  if (!monthSchema.safeParse(month).success)
    throw new ClientFailure("validation");
  const year = Number(month.slice(0, 4));
  const number = Number(month.slice(5));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days =
    number === 2 ? (leap ? 29 : 28) : [4, 6, 9, 11].includes(number) ? 30 : 31;
  return { from: `${month}-01`, to: `${month}-${days}` };
}
export function adjacentMonth(month: string, delta: -1 | 1): string | null {
  monthRange(month);
  const index =
    Number(month.slice(0, 4)) * 12 + Number(month.slice(5)) - 1 + delta;
  if (index < 12 || index >= 10000 * 12) return null;
  return `${String(Math.floor(index / 12)).padStart(4, "0")}-${String((index % 12) + 1).padStart(2, "0")}`;
}
export function monthLabel(month: string) {
  const names = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December"
  ];
  return `${names[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`;
}
export function moneyLabel(amountMinor: number, currency: Currency) {
  return `${currency} ${amountMinor < 0 ? "-" : ""}${amountText(Math.abs(amountMinor), currency)}`;
}
export function dashboardFailureMessage(error: unknown) {
  if (error instanceof ClientFailure) {
    if (error.kind === "rate-limit")
      return "Too many requests. Wait a moment, then try again.";
    if (error.kind === "validation")
      return "This monthly summary cannot be displayed. Check your selection or review transactions.";
  }
  return "The summary could not be loaded. Check your connection and try again.";
}

export function createApiDashboardSource(
  client: Transport,
  changes: Pick<TransactionSource, "subscribe">
): DashboardSource {
  return {
    subscribe: (listener) => changes.subscribe(listener),
    async summary({ month, currency }) {
      const { from, to } = monthRange(month);
      const result = await client.send(
        "GET",
        `/v1/dashboard/summary?from=${from}&to=${to}&currency=${currency}&recentLimit=5`,
        dashboardSchema
      );
      if (
        result.from !== from ||
        result.to !== to ||
        result.currency !== currency ||
        result.recentTransactions.some(
          (row) => row.currency !== currency || row.date < from || row.date > to
        )
      )
        throw new ClientFailure("protocol");
      return result;
    }
  };
}

// Explicit demo simulation only. Live finance totals always come from the API.
export function createDemoDashboardSource(
  transactions: TransactionSource,
  categories: CategorySource
): DashboardSource {
  return {
    subscribe: (listener) => transactions.subscribe(listener),
    async summary({ month, currency }) {
      const range = monthRange(month);
      let rows: Transaction[] = [];
      let after: string | undefined;
      do {
        const page = await transactions.list(range, after);
        rows = appendTransactionPage(rows, page, after);
        after = page.nextCursor ?? undefined;
      } while (after);
      const names = new Map(
        (await categories.list()).map((category) => [
          category.id,
          category.name
        ])
      );
      const matching = rows.filter((row) => row.currency === currency);
      const groups = new Map<
        string,
        {
          categoryId: string;
          categoryName: string;
          income: bigint;
          expenses: bigint;
        }
      >();
      let income = 0n;
      let expenses = 0n;
      for (const row of matching) {
        const group = groups.get(row.categoryId) ?? {
          categoryId: row.categoryId,
          categoryName: names.get(row.categoryId) ?? "Unavailable category",
          income: 0n,
          expenses: 0n
        };
        if (row.direction === "income") {
          group.income += BigInt(row.amountMinor);
          income += BigInt(row.amountMinor);
        } else {
          group.expenses += BigInt(row.amountMinor);
          expenses += BigInt(row.amountMinor);
        }
        groups.set(row.categoryId, group);
      }
      function totals(income: bigint, expenses: bigint) {
        if (
          income > BigInt(Number.MAX_SAFE_INTEGER) ||
          expenses > BigInt(Number.MAX_SAFE_INTEGER)
        )
          throw new ClientFailure("validation");
        return {
          incomeMinor: Number(income),
          expensesMinor: Number(expenses),
          netMinor: Number(income - expenses)
        };
      }
      return {
        ...range,
        currency,
        ...totals(income, expenses),
        categoryBreakdown: [...groups.values()]
          .sort((a, b) => a.categoryId.localeCompare(b.categoryId))
          .map((group) => ({
            categoryId: group.categoryId,
            categoryName: group.categoryName,
            ...totals(group.income, group.expenses)
          })),
        recentTransactions: matching.slice(0, 5)
      };
    }
  };
}
