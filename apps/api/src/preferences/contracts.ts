import { z } from "zod";
import { currencySchema } from "../transactions/contracts.js";

export const preferencesSchema = z.object({
  entryCurrency: currencySchema,
  currencyLocked: z.boolean(),
  // Financial accounts arrive in #68; there cannot be a selected account yet.
  defaultAccountId: z.null()
});
export const preferencesPatch = z.strictObject({
  entryCurrency: currencySchema
});
