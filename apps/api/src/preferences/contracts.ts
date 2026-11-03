import { z } from "zod";
import { currencySchema } from "../transactions/contracts.js";

export const preferencesSchema = z.object({
  entryCurrency: currencySchema,
  currencyLocked: z.boolean(),
  defaultAccountId: z.uuid().nullable()
});
export const preferencesPatch = z
  .strictObject({
    entryCurrency: currencySchema.optional(),
    defaultAccountId: z.uuid().nullable().optional()
  })
  .refine((value) => Object.keys(value).length > 0);
export type PreferencesPatch = z.infer<typeof preferencesPatch>;
