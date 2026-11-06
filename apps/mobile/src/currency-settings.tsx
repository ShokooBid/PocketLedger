import { useState } from "react";
import { Body, Button, StateNotice } from "./ui";
import { currencyExponents, type Currency } from "./transaction-data";
import type { CurrencySettingsState } from "./preference-data";

export function CurrencySettings({
  defaultCurrency,
  state
}: {
  defaultCurrency: Currency | null;
  state?: CurrencySettingsState;
}) {
  return (
    <>
      <Body>Default currency: {defaultCurrency ?? "Not chosen"}</Body>
      <Body>
        Choose your currency once during setup. It cannot be changed afterwards.
        Existing amounts are never converted.
      </Body>
      {state?.status === "loading" && (
        <StateNotice
          kind="loading"
          title="Loading currency settings"
          message="Checking your permanent currency choice."
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
    </>
  );
}

// Selection is local until explicit confirmation. CAD is a suggestion, never an
// implicit saved preference. Settings deliberately does not render this form.
export function CurrencySelection({
  onConfirm,
  disabled
}: {
  onConfirm: (currency: Currency) => Promise<void>;
  disabled: boolean;
}) {
  const [selected, setSelected] = useState<Currency>("CAD");
  return (
    <>
      <Body>
        Choose the currency you will use for your accounts and transactions.
      </Body>
      <Body>This choice is permanent. Review it before confirming.</Body>
      {(Object.keys(currencyExponents) as Currency[]).map((currency) => (
        <Button
          key={currency}
          label={`Choose currency ${currency}`}
          selected={currency === selected}
          disabled={disabled}
          onPress={() => setSelected(currency)}
        />
      ))}
      <Button
        label={`Confirm ${selected} permanently`}
        variant="primary"
        disabled={disabled}
        onPress={() => void onConfirm(selected)}
      />
    </>
  );
}
