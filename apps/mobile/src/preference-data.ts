import { z } from "zod";
import { currencySchema, type Currency } from "./transaction-data";
import { ClientFailure, type Transport } from "./auth/transport";

export const currencyPreferencesSchema = z.object({
  entryCurrency: currencySchema,
  currencyLocked: z.boolean(),
  defaultAccountId: z.null()
});
export type CurrencyPreferences = z.infer<typeof currencyPreferencesSchema>;
export type CurrencySettingsState = {
  enabled: boolean;
  initialized: boolean;
  status: "loading" | "ready" | "error";
  locked: boolean;
  saving: boolean;
  error: string | null;
  reload: () => Promise<void>;
};
export function createApiPreferencesSource(client: Transport) {
  return {
    get: () => client.send("GET", "/v2/preferences", currencyPreferencesSchema),
    update: (entryCurrency: Currency) =>
      client.send("PATCH", "/v2/preferences", currencyPreferencesSchema, {
        entryCurrency
      })
  };
}
export function preferenceFailureMessage(error: unknown) {
  if (error instanceof ClientFailure) {
    if (error.code === "CURRENCY_LOCKED")
      return "Currency is locked after the first saved transaction. Reload currency settings.";
    if (error.code === "CURRENCY_SETUP_REQUIRED")
      return "This preview needs a fresh test ledger before currency settings can be enabled.";
    if (error.code === "FINANCE_FEATURE_DISABLED")
      return "Currency settings are not available in this release.";
  }
  return "Currency settings could not be confirmed. Reload before making another change.";
}
