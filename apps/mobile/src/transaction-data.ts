import { z } from "zod";
import type { CategorySource } from "./category-data";
import { ClientFailure } from "./auth/transport";
import {
  observeTransactions,
  type TransactionChange
} from "./transaction-history";

// Client projection of the documented API policy, independent of native UI.
export const currencyExponents = {
  USD: 2,
  EUR: 2,
  GBP: 2,
  INR: 2,
  JPY: 0,
  KWD: 3
} as const;
export const currencySchema = z.enum([
  "USD",
  "EUR",
  "GBP",
  "INR",
  "JPY",
  "KWD"
]);
export type Currency = keyof typeof currencyExponents;
export const calendarDate = z.iso
  .date()
  .refine((value) => value >= "0001-01-01");
const text = (max: number) =>
  z
    .string()
    .max(max)
    .refine((value) => !/[\p{Cc}\p{Cf}\p{Cs}]/u.test(value));
export const transactionInput = z.strictObject({
  direction: z.enum(["income", "expense"]),
  amountMinor: z.number().int().min(1).max(2147483647),
  currency: currencySchema,
  date: calendarDate,
  categoryId: z.string().min(1),
  merchant: text(200).refine((value) => /\S/u.test(value)),
  note: text(2000).nullable()
});
export const transactionSchema = transactionInput.extend({
  id: z.uuid(),
  categoryId: z.uuid(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
});
export const pageSchema = z.object({
  items: z.array(transactionSchema),
  nextCursor: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}_[0-9a-f-]{36}$/)
    .nullable()
});
export type TransactionInput = z.infer<typeof transactionInput>;
export type Transaction = z.infer<typeof transactionSchema>;
export type TransactionPage = z.infer<typeof pageSchema>;
export type TransactionFilter = {
  from?: string;
  to?: string;
  categoryId?: string;
  direction?: "income" | "expense";
};
export function validDateFilter({ from, to }: TransactionFilter): boolean {
  return (
    (!from && !to) ||
    (calendarDate.safeParse(from).success &&
      calendarDate.safeParse(to).success &&
      from! <= to! &&
      Date.parse(to!) - Date.parse(from!) <= 366 * 86400000)
  );
}
export interface TransactionSource {
  get(id: string): Promise<Transaction>;
  subscribe(listener: (change: TransactionChange) => void): () => void;
  list(filter: TransactionFilter, after?: string): Promise<TransactionPage>;
  create(input: TransactionInput): Promise<Transaction>;
  update(id: string, input: TransactionInput): Promise<Transaction>;
  remove(id: string): Promise<void>;
}
export function parseAmount(raw: string, currency: Currency): number {
  const exponent = currencyExponents[currency];
  if (raw.length > 30 || !/^\d+(?:\.\d+)?$/.test(raw) || /\s/.test(raw))
    throw new Error("amount");
  const [whole, fraction = ""] = raw.split(".");
  if (fraction.length > exponent) throw new Error("amount");
  // Concatenate decimal digits, then convert the bounded integer. No decimal
  // floating-point parsing, multiplication, rounding or truncation occurs.
  const units = BigInt(whole! + fraction.padEnd(exponent, "0"));
  if (units < 1n || units > 2147483647n) throw new Error("amount");
  return Number(units);
}
export function amountText(amountMinor: number, currency: Currency): string {
  const exponent = currencyExponents[currency];
  const digits = String(amountMinor).padStart(exponent + 1, "0");
  return exponent
    ? `${digits.slice(0, -exponent)}.${digits.slice(-exponent)}`
    : digits;
}
export type TransactionDraft = {
  direction: "income" | "expense";
  amount: string;
  currency: Currency;
  date: string;
  categoryId: string;
  merchant: string;
  note: string;
};
export function draftInput(draft: TransactionDraft): TransactionInput {
  return transactionInput.parse({
    direction: draft.direction,
    amountMinor: parseAmount(draft.amount, draft.currency),
    currency: draft.currency,
    date: draft.date,
    categoryId: draft.categoryId,
    merchant: draft.merchant,
    note: draft.note || null
  });
}
export function uncertainWrite(error: unknown) {
  return (
    !(error instanceof ClientFailure) ||
    ["network", "server", "protocol"].includes(error.kind)
  );
}
export function transactionFailureMessage(error: unknown) {
  if (error instanceof ClientFailure) {
    if (error.kind === "validation")
      return "Check the fields and choose an active category. Reload categories if it was archived.";
    if (error.kind === "unavailable")
      return "This transaction is unavailable. Reload the list.";
    if (error.kind === "rate-limit")
      return "Too many attempts. Wait before trying again.";
  }
  return "The change could not be confirmed. Reload and review saved transactions before deciding whether to submit again.";
}
export function createDemoTransactionSource(
  categories: CategorySource
): TransactionSource {
  let rows: Transaction[] = [];
  let sequence = 0;
  async function checked(input: TransactionInput, previous?: Transaction) {
    if (!transactionInput.safeParse(input).success)
      throw new ClientFailure("validation");
    const category = (await categories.list()).find(
      (row) => row.id === input.categoryId
    );
    if (
      !category ||
      (category.archivedAt && previous?.categoryId !== category.id)
    )
      throw new ClientFailure("validation");
  }
  return observeTransactions({
    async get(id) {
      const row = rows.find((row) => row.id === id);
      if (!row) throw new ClientFailure("unavailable");
      return { ...row };
    },
    async list(filter, after) {
      const sorted = rows
        .filter(
          (row) =>
            (!filter.from || row.date >= filter.from) &&
            (!filter.to || row.date <= filter.to) &&
            (!filter.categoryId || row.categoryId === filter.categoryId) &&
            (!filter.direction || row.direction === filter.direction)
        )
        .sort((a, b) => `${b.date}_${b.id}`.localeCompare(`${a.date}_${a.id}`))
        .filter((row) => !after || `${row.date}_${row.id}` < after);
      const items = sorted.slice(0, 50).map((row) => ({ ...row }));
      const last = items.at(-1);
      return {
        items,
        nextCursor:
          sorted.length > 50 && last ? `${last.date}_${last.id}` : null
      };
    },
    async create(input) {
      await checked(input);
      const row = {
        ...input,
        id: `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      rows.push(row);
      return { ...row };
    },
    async update(id, input) {
      const previous = rows.find((row) => row.id === id);
      if (!previous) throw new ClientFailure("unavailable");
      await checked(input, previous);
      const updated = {
        ...previous,
        ...input,
        updatedAt: new Date().toISOString()
      };
      rows = rows.map((row) => (row.id === id ? updated : row));
      return { ...updated };
    },
    async remove(id) {
      if (!rows.some((row) => row.id === id))
        throw new ClientFailure("unavailable");
      rows = rows.filter((row) => row.id !== id);
    }
  });
}
