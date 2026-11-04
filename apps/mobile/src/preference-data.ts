import { z } from "zod";
import { currencySchema, type Currency } from "./transaction-data";
import { ClientFailure, type Transport } from "./auth/transport";

export const currencyPreferencesSchema = z.object({
  entryCurrency: currencySchema,
  currencyLocked: z.boolean(),
  defaultAccountId: z.uuid().nullable()
});
export type CurrencyPreferences = z.infer<typeof currencyPreferencesSchema>;
export type CurrencySettingsState = {
  initialized: boolean;
  status: "loading" | "ready" | "error";
  locked: boolean;
  saving: boolean;
  error: string | null;
  reload: () => Promise<void>;
};
export function createApiPreferencesSource(client: Transport) {
  return {
    get: () => client.send("GET", "/v1/preferences", currencyPreferencesSchema),
    selectAccount: (defaultAccountId: string | null) =>
      client.send("PATCH", "/v1/preferences", currencyPreferencesSchema, {
        defaultAccountId
      }),
    update: (entryCurrency: Currency) =>
      client.send("PATCH", "/v1/preferences", currencyPreferencesSchema, {
        entryCurrency
      })
  };
}
export function preferenceFailureMessage(error: unknown) {
  if (error instanceof ClientFailure) {
    if (error.code === "CURRENCY_LOCKED")
      return "Currency is locked after the first saved transaction. Reload currency settings.";
  }
  return "Currency settings could not be confirmed. Reload before making another change.";
}
