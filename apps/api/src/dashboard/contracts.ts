import { z } from "zod";
import {
  calendarDate,
  currencySchema,
  transactionSchema
} from "../transactions/contracts.js";

export const summaryQuery = z
  .strictObject({
    from: calendarDate,
    to: calendarDate,
    currency: currencySchema,
    recentLimit: z.coerce.number().int().min(1).max(20).default(5)
  })
  .refine(
    ({ from, to }) =>
      from <= to && Date.parse(to) - Date.parse(from) <= 366 * 86400000
  );

const totals = z.object({
  incomeMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  expensesMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  netMinor: z
    .number()
    .int()
    .min(-Number.MAX_SAFE_INTEGER)
    .max(Number.MAX_SAFE_INTEGER)
});
export const summarySchema = totals.extend({
  from: calendarDate,
  to: calendarDate,
  currency: currencySchema,
  categoryBreakdown: z.array(
    totals.extend({ categoryId: z.uuid(), categoryName: z.string() })
  ),
  recentTransactions: z.array(transactionSchema).max(20)
});
export type SummaryQuery = z.infer<typeof summaryQuery>;
