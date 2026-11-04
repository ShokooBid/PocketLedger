import { z } from "zod";
export const currencySchema = z.enum([
  "CAD",
  "USD",
  "EUR",
  "GBP",
  "INR",
  "JPY",
  "KWD"
]);
export const calendarDate = z.iso
  .date()
  .refine((value) => value >= "0001-01-01");
const text = (max: number) =>
  z
    .string()
    .max(max)
    .refine((value) => !/[\p{Cc}\p{Cf}\p{Cs}]/u.test(value));
export const transactionInput = z.strictObject({
  accountId: z.uuid(),
  categoryId: z.uuid(),
  direction: z.enum(["income", "expense"]),
  amountMinor: z.number().int().min(1).max(2147483647),
  currency: currencySchema,
  date: calendarDate,
  note: text(2000).nullable().default(null)
});
export const transactionCreate = transactionInput.extend({
  clientRequestId: z.uuid()
});
export const transactionPatch = transactionInput
  .extend({ note: text(2000).nullable() })
  .partial()
  .refine((input) => Object.keys(input).length > 0);
export const transactionSchema = transactionInput.extend({
  id: z.uuid(),
  importId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
});
export const cursorSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}_[0-9a-f-]{36}$/)
  .refine(
    (value) =>
      calendarDate.safeParse(value.slice(0, 10)).success &&
      z.uuid().safeParse(value.slice(11)).success
  );
export const transactionQuery = z
  .strictObject({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    after: cursorSchema.optional(),
    from: calendarDate.optional(),
    to: calendarDate.optional(),
    accountId: z.uuid().optional(),
    categoryId: z.uuid().optional(),
    currency: currencySchema.optional(),
    direction: z.enum(["income", "expense"]).optional(),
    includeSubcategories: z
      .enum(["true", "false"])
      .transform((value) => value === "true")
      .optional()
  })
  .refine(
    (q) =>
      (!q.includeSubcategories || !!q.categoryId) &&
      ((!q.from && !q.to) ||
        (!!q.from &&
          !!q.to &&
          q.from <= q.to &&
          Date.parse(q.to) - Date.parse(q.from) <= 366 * 86400000))
  );
export type TransactionInput = z.infer<typeof transactionInput>;
export type TransactionCreate = z.infer<typeof transactionCreate>;
export type TransactionPatch = z.infer<typeof transactionPatch>;
export type TransactionQuery = z.infer<typeof transactionQuery>;
