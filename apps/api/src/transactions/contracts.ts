import { z } from "zod";

// Deliberate MVP allowlist; mobile's projection is checked by integration tests.
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
  direction: z.enum(["income", "expense"]),
  amountMinor: z.number().int().min(1).max(2147483647),
  currency: currencySchema,
  date: calendarDate,
  categoryId: z.uuid(),
  merchant: text(200).refine((value) => /\S/u.test(value)),
  note: text(2000).nullable().default(null)
});
export const transactionPatch = transactionInput
  .extend({ note: text(2000).nullable() })
  .partial()
  .refine((value) => Object.keys(value).length > 0);
export const transactionSchema = transactionInput.extend({
  id: z.uuid(),
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
    categoryId: z.uuid().optional(),
    direction: z.enum(["income", "expense"]).optional()
  })
  .refine(
    (q) =>
      (!q.from && !q.to) ||
      (!!q.from &&
        !!q.to &&
        q.from <= q.to &&
        Date.parse(q.to) - Date.parse(q.from) <= 366 * 86400000)
  );
export type TransactionInput = z.infer<typeof transactionInput>;
export type TransactionPatch = z.infer<typeof transactionPatch>;
export type TransactionQuery = z.infer<typeof transactionQuery>;
