import { z } from "zod";
import { financeName } from "../finance/names.js";
import { calendarDate, currencySchema } from "../transactions/contracts.js";

export const accountType = z.enum(["cash", "bank", "credit", "other"]);
export const openingBalanceMinor = z
  .number()
  .int()
  .min(-2147483647)
  .max(2147483647);
export const accountInput = z.strictObject({
  name: financeName,
  type: accountType,
  // Assertion copied from Settings; the server checks it under the owner lock.
  currency: currencySchema,
  openingBalanceMinor: openingBalanceMinor.default(0),
  openingDate: calendarDate
});
export const accountPatch = z
  .strictObject({ name: financeName.optional(), type: accountType.optional() })
  .refine((value) => Object.keys(value).length > 0);
export const accountQuery = z.strictObject({
  status: z.enum(["active", "archived", "all"]).default("active"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  after: z.uuid().optional()
});
export const accountBalanceQuery = z.strictObject({
  asOf: calendarDate.optional()
});
export const accountSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  type: accountType,
  currency: currencySchema,
  openingBalanceMinor,
  openingDate: calendarDate,
  archivedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
});
export const accountDetailSchema = accountSchema.extend({
  asOf: calendarDate,
  balanceMinor: z
    .number()
    .int()
    .min(Number.MIN_SAFE_INTEGER)
    .max(Number.MAX_SAFE_INTEGER)
});
export type AccountInput = z.infer<typeof accountInput>;
export type AccountPatch = z.infer<typeof accountPatch>;
export type AccountQuery = z.infer<typeof accountQuery>;
