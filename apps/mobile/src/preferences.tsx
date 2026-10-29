import {
  createContext,
  useContext,
  useState,
  type PropsWithChildren
} from "react";
import { currencySchema, type Currency } from "./transaction-data";

type Preferences = {
  defaultCurrency: Currency;
  setDefaultCurrency: (currency: Currency) => void;
};
const Context = createContext<Preferences | null>(null);

// Lives under the session-keyed app provider. No finance preferences or account
// identifiers are persisted; account changes/logout reset to the documented USD.
export function PreferencesProvider({ children }: PropsWithChildren) {
  const [defaultCurrency, setCurrency] = useState<Currency>("USD");
  return (
    <Context.Provider
      value={{
        defaultCurrency,
        setDefaultCurrency: (currency) =>
          setCurrency(currencySchema.parse(currency))
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function usePreferences() {
  const preferences = useContext(Context);
  if (!preferences) throw new Error("PreferencesProvider is required.");
  return preferences;
}
