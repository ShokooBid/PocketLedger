import { z } from "zod";
import { calendarDate, currencySchema } from "../transactions/contracts.js";

export const historyKind = z.enum(["transaction", "transfer"]);
const uuid = z.uuid().transform((value) => value.toLowerCase());
export const historyCursor = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}_[0-9a-f-]{36}_(transaction|transfer)$/)
  .refine(
    (value) =>
      calendarDate.safeParse(value.slice(0, 10)).success &&
      z.uuid().safeParse(value.slice(11, 47)).success
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
export const historyQuery = historyFilters
  .extend({
    includeSubcategories: z
      .enum(["true", "false"])
      .transform((value) => value === "true")
      .optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    after: historyCursor.optional(),
    before: historyCursor.optional(),
    focusId: uuid.optional(),
    focusKind: historyKind.optional()
  })
  .strict()
  .refine(
    (q) =>
      (!q.includeSubcategories || !!q.categoryId) &&
      ((!q.from && !q.to) ||
        (!!q.from &&
          !!q.to &&
          q.from <= q.to &&
          Date.parse(q.to) - Date.parse(q.from) <= 366 * 86400000)) &&
      Number(!!q.after) + Number(!!q.before) + Number(!!q.focusId) <= 1 &&
      !!q.focusId === !!q.focusKind
  );
export const historyRow = z.object({
  kind: historyKind,
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
});
const safeInteger = z
  .number()
  .int()
  .min(-Number.MAX_SAFE_INTEGER)
  .max(Number.MAX_SAFE_INTEGER);
export const historyDay = z.object({
  date: calendarDate,
  currency: currencySchema,
  count: safeInteger.nonnegative(),
  incomeMinor: safeInteger.nonnegative(),
  expensesMinor: safeInteger.nonnegative(),
  netMinor: safeInteger
});
export const historyPage = z.object({
  items: z.array(historyRow).max(100),
  days: z.array(historyDay).max(700),
  nextCursor: historyCursor.nullable(),
  previousCursor: historyCursor.nullable(),
  applied: historyFilters,
  adjustments: z.array(z.string()),
  focusedKey: historyCursor.nullable()
});
export type HistoryQuery = z.infer<typeof historyQuery>;
export type HistoryFilters = z.infer<typeof historyFilters>;
export type HistoryRow = z.infer<typeof historyRow>;
