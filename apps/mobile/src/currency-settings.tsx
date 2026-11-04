import { Body, Button, StateNotice } from "./ui";
import { currencyExponents, type Currency } from "./transaction-data";
import type { CurrencySettingsState } from "./preference-data";

export function CurrencySettings({
  defaultCurrency,
  setDefaultCurrency,
  state,
  disabled = false
}: {
  defaultCurrency: Currency;
  setDefaultCurrency: (currency: Currency) => void;
  state?: CurrencySettingsState;
  disabled?: boolean;
}) {
  return (
    <>
      <Body>Default currency: {defaultCurrency}</Body>
      <Body>
        Your currency is saved for this account. The first saved transaction
        locks it. Existing amounts are never converted.
      </Body>
      {state?.locked && (
        <Body>Currency is locked after the first saved transaction.</Body>
      )}
      {state?.status === "loading" && (
        <StateNotice
          kind="loading"
          title="Loading currency settings"
          message="Checking the saved currency and lock."
        />
      )}
      {state?.saving && (
        <StateNotice
          kind="loading"
          title="Saving currency"
          message="Waiting for confirmation."
        />
      )}
      {state?.error && (
        <StateNotice
          kind="error"
          title="Currency settings need attention"
          message={state.error}
          onRetry={() => void state.reload()}
        />
      )}
      {(Object.keys(currencyExponents) as Currency[]).map((currency) => (
        <Button
          key={currency}
          label={`Default currency ${currency}`}
          selected={currency === defaultCurrency}
          disabled={
            disabled ||
            (state !== undefined &&
              (state.locked || state.saving || state.status !== "ready"))
          }
          onPress={() => void setDefaultCurrency(currency)}
        />
      ))}
    </>
  );
}
