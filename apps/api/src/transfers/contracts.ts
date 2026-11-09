import { z } from "zod";
import {
  calendarDate,
  currencySchema,
  cursorSchema
} from "../transactions/contracts.js";

// UI supplies existing account IDs. Category and currency are deliberately absent.
export const transferInput = z.strictObject({
  fromAccountId: z.uuid(),
  toAccountId: z.uuid(),
  amountMinor: z.number().int().min(1).max(2147483647),
  date: calendarDate,
  note: z
    .string()
    .max(2000)
    .refine((value) => !/[\p{Cc}\p{Cf}\p{Cs}]/u.test(value))
    .nullable()
    .default(null)
});
export const transferCreate = transferInput.extend({
  clientRequestId: z.uuid()
});
export const transferPatch = transferInput
  .extend({ note: transferInput.shape.note.removeDefault() })
  .partial()
  .refine((value) => Object.keys(value).length > 0);
export const transferSchema = transferInput.extend({
  id: z.uuid(),
  currency: currencySchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
});
export const transferQuery = z
  .strictObject({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    after: cursorSchema.optional(),
    accountId: z.uuid().optional(),
    from: calendarDate.optional(),
    to: calendarDate.optional()
  })
  .refine(
    (value) =>
      (!value.from && !value.to) ||
      (!!value.from &&
        !!value.to &&
        value.from <= value.to &&
        Date.parse(value.to) - Date.parse(value.from) <= 366 * 86400000)
  );
export type TransferInput = z.infer<typeof transferInput>;
export type TransferCreate = z.infer<typeof transferCreate>;
export type TransferPatch = z.infer<typeof transferPatch>;
export type TransferQuery = z.infer<typeof transferQuery>;
