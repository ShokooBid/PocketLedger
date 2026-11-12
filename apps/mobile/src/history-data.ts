import { z } from "zod";
import { ClientFailure, type Transport } from "./auth/transport";
import {
  calendarDate,
  currencySchema,
  amountText,
  type Currency
} from "./transaction-data";

const kindSchema = z.enum(["transaction", "transfer"]);
const uuid = z.uuid().transform((value) => value.toLowerCase());
export const historyCursor = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}_[0-9a-f-]{36}_(transaction|transfer)$/)
  .refine(
    (key) =>
      calendarDate.safeParse(key.slice(0, 10)).success &&
      z.uuid().safeParse(key.slice(11, 47)).success
  );
export const historyFilters = z.object({
  from: calendarDate.optional(),
  to: calendarDate.optional(),
  accountId: uuid.optional(),
  currency: currencySchema.optional(),
  type: z.enum(["income", "expense", "transfer"]).optional(),
  categoryId: uuid.optional(),
  includeSubcategories: z.boolean().optional()
});
export const historyRow = z
  .object({
    kind: kindSchema,
    id: z.uuid(),
    date: calendarDate,
    type: z.enum(["income", "expense", "transfer"]),
    amountMinor: z.number().int().positive().max(2147483647),
    currency: currencySchema,
    note: z.string().nullable(),
    accountId: z.uuid(),
    accountName: z.string(),
    toAccountId: z.uuid().nullable(),
    toAccountName: z.string().nullable(),
    categoryId: z.uuid().nullable(),
    categoryName: z.string().nullable(),
    parentCategoryId: z.uuid().nullable(),
    parentCategoryName: z.string().nullable(),
    iconKey: z.string().nullable()
  })
  .refine((row) =>
    row.kind === "transfer"
      ? row.type === "transfer" &&
        !!row.toAccountId &&
        !!row.toAccountName &&
        row.categoryId === null
      : row.type !== "transfer" && !!row.categoryId && row.toAccountId === null
  );
const safeInteger = z
  .number()
  .int()
  .min(-Number.MAX_SAFE_INTEGER)
  .max(Number.MAX_SAFE_INTEGER);
export const historyDay = z
  .object({
    date: calendarDate,
    currency: currencySchema,
    count: safeInteger.positive(),
    incomeMinor: safeInteger.nonnegative(),
    expensesMinor: safeInteger.nonnegative(),
    netMinor: safeInteger
  })
  .refine(
    (day) =>
      BigInt(day.netMinor) ===
      BigInt(day.incomeMinor) - BigInt(day.expensesMinor)
  );
export const historyPage = z.object({
  items: z.array(historyRow).max(100),
  days: z.array(historyDay).max(700),
  nextCursor: historyCursor.nullable(),
  previousCursor: historyCursor.nullable(),
  applied: historyFilters,
  adjustments: z.array(z.string()),
  focusedKey: historyCursor.nullable()
});
export const historyFocus = z.object({ id: uuid, kind: kindSchema });
export type HistoryFocus = z.infer<typeof historyFocus>;
export type HistoryFilters = z.infer<typeof historyFilters>;
export type HistoryRow = z.infer<typeof historyRow>;
export type HistoryDay = z.infer<typeof historyDay>;
export type HistoryPage = z.infer<typeof historyPage>;
export type HistoryPosition = {
  after?: string;
  before?: string;
  focus?: HistoryFocus;
};
export interface HistorySource {
  list(
    filter: HistoryFilters,
    position?: HistoryPosition
  ): Promise<HistoryPage>;
}
export const historyKey = (row: Pick<HistoryRow, "date" | "id" | "kind">) =>
  `${row.date}_${row.id}_${row.kind}`;
export function validHistoryFilters(filter: HistoryFilters) {
  return (
    historyFilters.safeParse(filter).success &&
    (!filter.includeSubcategories || !!filter.categoryId) &&
    ((!filter.from && !filter.to) ||
      (!!filter.from &&
        !!filter.to &&
        filter.from <= filter.to &&
        Date.parse(filter.to) - Date.parse(filter.from) <= 366 * 86400000))
  );
}
export function matchesHistory(row: HistoryRow, filter: HistoryFilters) {
  return (
    (!filter.from || row.date >= filter.from) &&
    (!filter.to || row.date <= filter.to) &&
    (!filter.accountId ||
      filter.accountId === row.accountId ||
      filter.accountId === row.toAccountId) &&
    (!filter.currency || row.currency === filter.currency) &&
    (!filter.type || filter.type === row.type) &&
    (!filter.categoryId ||
      filter.categoryId === row.categoryId ||
      (!!filter.includeSubcategories &&
        filter.categoryId === row.parentCategoryId))
  );
}
export function createApiHistorySource(client: Transport): HistorySource {
  return {
    async list(filter, position = {}) {
      if (!validHistoryFilters(filter)) throw new ClientFailure("validation");
      filter = historyFilters.parse(filter);
      if (
        Number(!!position.after) +
          Number(!!position.before) +
          Number(!!position.focus) >
        1
      )
        throw new ClientFailure("validation");
      for (const cursor of [position.after, position.before])
        if (cursor && !historyCursor.safeParse(cursor).success)
          throw new ClientFailure("validation");
      if (position.focus && !historyFocus.safeParse(position.focus).success)
        throw new ClientFailure("validation");
      if (position.focus)
        position = { ...position, focus: historyFocus.parse(position.focus) };
      const query = Object.entries({
        ...filter,
        limit: 50,
        after: position.after,
        before: position.before,
        focusId: position.focus?.id,
        focusKind: position.focus?.kind
      })
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
        .join("&");
      const page = await client.send(
        "GET",
        `/v1/history?${query}`,
        historyPage
      );
      const allKeys = new Set([
        ...Object.keys(filter),
        ...Object.keys(page.applied)
      ]);
      if (
        !validHistoryFilters(page.applied) ||
        (!position.focus &&
          [...allKeys].some(
            (key) =>
              filter[key as keyof HistoryFilters] !==
              page.applied[key as keyof HistoryFilters]
          )) ||
        !!position.focus !== !!page.focusedKey ||
        (position.focus &&
          !page.items.some(
            (row) =>
              row.id === position.focus!.id &&
              row.kind === position.focus!.kind &&
              historyKey(row) === page.focusedKey
          )) ||
        page.items.some((row) => !matchesHistory(row, page.applied))
      )
        throw new ClientFailure("protocol");
      validateHistoryPage(page, position);
      return page;
    }
  };
}
export function validateHistoryPage(
  page: HistoryPage,
  position: HistoryPosition = {}
) {
  const ids = new Set<string>();
  let previous: string | undefined;
  const aggregateKeys = new Set<string>();
  for (const day of page.days) {
    const key = `${day.date}_${day.currency}`;
    if (
      aggregateKeys.has(key) ||
      !page.items.some((row) => row.date === day.date)
    )
      throw new ClientFailure("protocol");
    aggregateKeys.add(key);
  }
  for (const row of page.items) {
    const key = historyKey(row),
      id = `${row.kind}_${row.id}`;
    if (
      ids.has(id) ||
      (previous && key >= previous) ||
      (position.after && key >= position.after) ||
      (position.before && key <= position.before) ||
      !aggregateKeys.has(`${row.date}_${row.currency}`)
    )
      throw new ClientFailure("protocol");
    ids.add(id);
    previous = key;
  }
  const first = page.items[0],
    last = page.items.at(-1);
  if (
    (page.nextCursor && (!last || page.nextCursor !== historyKey(last))) ||
    (page.previousCursor &&
      (!first || page.previousCursor !== historyKey(first)))
  )
    throw new ClientFailure("protocol");
  for (const day of page.days) {
    if (
      page.items.filter(
        (row) => row.date === day.date && row.currency === day.currency
      ).length > day.count
    )
      throw new ClientFailure("protocol");
  }
}
export function mergeHistory(
  current: HistoryPage,
  incoming: HistoryPage,
  direction: "older" | "newer"
): HistoryPage {
  const cursor =
    direction === "older" ? current.nextCursor : current.previousCursor;
  if (!cursor) throw new ClientFailure("protocol");
  validateHistoryPage(
    incoming,
    direction === "older" ? { after: cursor } : { before: cursor }
  );
  const seen = new Set(current.items.map((row) => `${row.kind}_${row.id}`));
  const extra = incoming.items.filter(
    (row) => !seen.has(`${row.kind}_${row.id}`)
  );
  const days = new Map(
    current.days.map((day) => [`${day.date}_${day.currency}`, day])
  );
  for (const day of incoming.days) days.set(`${day.date}_${day.currency}`, day);
  return {
    ...current,
    items:
      direction === "older"
        ? [...current.items, ...extra]
        : [...extra, ...current.items],
    days: [...days.values()],
    nextCursor:
      direction === "older" ? incoming.nextCursor : current.nextCursor,
    previousCursor:
      direction === "newer" ? incoming.previousCursor : current.previousCursor
  };
}
export function historyDateLabel(date: string) {
  // UTC here formats an already chosen accounting date; it never converts a
  // device timestamp into the date used for filtering/grouping.
  return new Intl.DateTimeFormat("en", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC"
  }).format(new Date(`${date}T12:00:00Z`));
}
export function signedMoney(amount: number, currency: Currency) {
  return `${amount < 0 ? "−" : amount > 0 ? "+" : ""}${currency} ${amountText(Math.abs(amount), currency)}`;
}
export function historyRecordText(
  row: HistoryRow,
  statementAccountId?: string
) {
  const transfer = row.kind === "transfer";
  const category = row.parentCategoryName
    ? `${row.parentCategoryName} / ${row.categoryName}`
    : row.categoryName;
  const direction =
    statementAccountId === row.accountId
      ? -1
      : statementAccountId === row.toAccountId
        ? 1
        : 0;
  return {
    category,
    description:
      row.note ||
      (transfer ? "Transfer" : category || `Transaction on ${row.date}`),
    accounts: transfer
      ? `${row.accountName} → ${row.toAccountName}`
      : row.accountName,
    typeLabel: transfer
      ? direction < 0
        ? "Outgoing transfer"
        : direction > 0
          ? "Incoming transfer"
          : "Transfer"
      : row.type,
    amount:
      transfer && !direction
        ? `${row.currency} ${amountText(row.amountMinor, row.currency)}`
        : signedMoney(
            row.amountMinor *
              (transfer ? direction : row.type === "expense" ? -1 : 1),
            row.currency
          )
  };
}
export function historyFailureMessage(error: unknown) {
  if (error instanceof ClientFailure) {
    if (error.code === "SUMMARY_AMOUNT_OUT_OF_RANGE")
      return "Daily totals exceed the supported range. Narrow the account/category filters.";
    if (error.kind === "validation")
      return "Check the filters: use both real dates, in order and no more than 366 days apart.";
    if (error.kind === "unavailable")
      return "The selected record, account or category is unavailable. Clear the selection and reload History.";
    if (error.kind === "rate-limit")
      return "Too many requests. Wait a moment, then try again.";
  }
  return "History could not be refreshed. Previously loaded rows and totals may be out of date. Try again.";
}
