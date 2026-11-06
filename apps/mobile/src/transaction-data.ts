import { z } from "zod";
import type { Account, AccountSource } from "./account-data";
import type { CategorySource } from "./category-data";
import { ClientFailure } from "./auth/transport";
import {
  observeTransactions,
  type TransactionChange
} from "./transaction-history";

// Client projection of the documented API policy, independent of native UI.
export const currencyExponents = {
  CAD: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
  INR: 2,
  JPY: 0,
  KWD: 3
} as const;
export const currencySchema = z.enum([
  "CAD",
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
  date: calendarDate,
  categoryId: z.string().min(1),
  accountId: z.string().min(1),
  note: text(2000).nullable()
});
export const transactionSchema = transactionInput.extend({
  currency: currencySchema,
  id: z.uuid(),
  categoryId: z.uuid(),
  accountId: z.uuid(),
  importId: z.uuid().nullable(),
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
export const transactionCreate = transactionInput.extend({
  clientRequestId: z.uuid()
});
export const transactionPatch = transactionInput
  .partial()
  .refine((input) => Object.keys(input).length > 0);
export type TransactionPatch = z.infer<typeof transactionPatch>;
export type TransactionCreate = z.infer<typeof transactionCreate>;
export type TransactionInput = z.infer<typeof transactionInput>;
export type Transaction = z.infer<typeof transactionSchema>;
export type TransactionPage = z.infer<typeof pageSchema>;
export type TransactionFilter = {
  accountId?: string;
  currency?: Currency;
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
  create(input: TransactionCreate): Promise<Transaction>;
  update(id: string, input: TransactionPatch): Promise<Transaction>;
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
  accountId: string;
  note: string;
};
export function draftInput(
  draft: TransactionDraft,
  account: Pick<Account, "id" | "currency">
): TransactionInput {
  // The draft currency is a snapshot for recovery, never a write authority.
  if (draft.accountId !== account.id || draft.currency !== account.currency)
    throw new ClientFailure("validation", "CURRENCY_MISMATCH");
  return transactionInput.parse({
    direction: draft.direction,
    amountMinor: parseAmount(draft.amount, account.currency),
    date: draft.date,
    categoryId: draft.categoryId,
    accountId: draft.accountId,
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
    if (error.code === "CURRENCY_MISMATCH")
      return "Choose an account in the draft's original currency. Amounts cannot be converted.";
    if (error.code === "PREFERENCES_NOT_READY")
      return "Reload currency settings before saving this transaction.";
    if (error.kind === "validation")
      return "Check the fields and choose an active account and category.";
    if (error.kind === "unavailable")
      return "This transaction is unavailable. Reload the list.";
    if (error.kind === "rate-limit")
      return "Too many attempts. Wait before trying again.";
  }
  return "The change could not be confirmed. Reload and review saved transactions before deciding whether to submit again.";
}
export function createDemoTransactionSource(
  categories: CategorySource,
  accounts: Pick<AccountSource, "list">,
  beforeWrite?: (currency: Currency, previous?: Transaction) => void
): TransactionSource {
  type StoredTransaction = Omit<Transaction, "currency"> & {
    clientRequestId: string;
    creationFingerprint: string;
  };
  let rows: StoredTransaction[] = [];
  let sequence = 0;
  // Serialize demo writes too: validation awaits must not let equal creates race.
  let writes = Promise.resolve();
  function write<T>(action: () => Promise<T>) {
    const result = writes.then(action);
    writes = result.then(
      () => {},
      () => {}
    );
    return result;
  }
  async function serialize(row: StoredTransaction): Promise<Transaction> {
    const account = (await accounts.list()).find(
      (item) => item.id === row.accountId
    );
    if (!account) throw new ClientFailure("unavailable");
    // Keep internal creation identity out of the same public DTO as the API.
    return {
      id: row.id,
      accountId: row.accountId,
      categoryId: row.categoryId,
      direction: row.direction,
      amountMinor: row.amountMinor,
      date: row.date,
      note: row.note,
      importId: row.importId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      currency: account.currency
    };
  }
  async function checked(input: TransactionInput, previous?: Transaction) {
    if (!transactionInput.safeParse(input).success)
      throw new ClientFailure("validation");
    const account = (await accounts.list()).find(
      (row) => row.id === input.accountId
    );
    if (!account) throw new ClientFailure("unavailable");
    if (previous && account.currency !== previous.currency)
      throw new ClientFailure("validation", "CURRENCY_MISMATCH");
    if (
      (account.archivedAt && previous?.accountId !== account.id) ||
      input.date < account.openingDate
    )
      throw new ClientFailure("validation", "INVALID_ACCOUNT");
    const allCategories = await categories.list();
    const category = allCategories.find((row) => row.id === input.categoryId);
    if (
      !category ||
      ((category.archivedAt ||
        allCategories.find((parent) => parent.id === category.parentId)
          ?.archivedAt) &&
        previous?.categoryId !== category.id)
    )
      throw new ClientFailure("validation");
    return account.currency;
  }
  return observeTransactions({
    async get(id) {
      const row = rows.find((row) => row.id === id);
      if (!row) throw new ClientFailure("unavailable");
      return serialize(row);
    },
    async list(filter, after) {
      const sorted = (await Promise.all(rows.map(serialize)))
        .filter(
          (row) =>
            (!filter.accountId || row.accountId === filter.accountId) &&
            (!filter.currency || row.currency === filter.currency) &&
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
    create(request) {
      return write(async () => {
        const { clientRequestId: key, ...fields } =
          transactionCreate.parse(request);
        const canonicalId = (id: string) =>
          z.uuid().safeParse(id).success ? id.toLowerCase() : id;
        const clientRequestId = key.toLowerCase();
        const input = {
          ...fields,
          accountId: canonicalId(fields.accountId),
          categoryId: canonicalId(fields.categoryId),
          note: fields.note || null
        };
        // Memory compares the canonical creation text; only the server persists SHA-256.
        const creationFingerprint = JSON.stringify([
          input.accountId,
          input.categoryId,
          input.direction,
          input.amountMinor,
          input.date,
          input.note
        ]);
        const prior = rows.find(
          (row) => row.clientRequestId === clientRequestId
        );
        if (prior) {
          if (prior.creationFingerprint !== creationFingerprint)
            throw new ClientFailure("conflict", "IDEMPOTENCY_KEY_REUSED");
          return serialize(prior);
        }
        const currency = await checked(input);
        beforeWrite?.(currency);
        const row = {
          ...input,
          clientRequestId,
          creationFingerprint,
          importId: null,
          id: `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        rows.push(row);
        categories.recordPosting?.(row.id, row.categoryId);
        return serialize(row);
      });
    },
    update(id, input) {
      return write(async () => {
        const previous = rows.find((row) => row.id === id);
        if (!previous) throw new ClientFailure("unavailable");
        const previousResponse = await serialize(previous);
        const merged = transactionInput.parse({
          direction: previous.direction,
          amountMinor: previous.amountMinor,
          date: previous.date,
          categoryId: previous.categoryId,
          accountId: previous.accountId,
          note: previous.note,
          ...transactionPatch.parse(input)
        });
        const currency = await checked(merged, previousResponse);
        beforeWrite?.(currency, previousResponse);
        const updated = {
          ...previous,
          ...merged,
          updatedAt: new Date().toISOString()
        };
        rows = rows.map((row) => (row.id === id ? updated : row));
        categories.recordPosting?.(updated.id, updated.categoryId);
        return serialize(updated);
      });
    },
    remove(id) {
      return write(async () => {
        if (!rows.some((row) => row.id === id))
          throw new ClientFailure("unavailable");
        rows = rows.filter((row) => row.id !== id);
        categories.recordPosting?.(id, null);
      });
    }
  });
}
