import {
  createContext,
  useContext,
  useState,
  type PropsWithChildren
} from "react";
import { useCategories } from "./category-context";
import { useSession } from "./session";
import { usePreferences } from "./preferences";
import { createApiTransactionSource } from "./transaction-api";
import { ClientFailure } from "./auth/transport";
import {
  createDemoTransactionSource,
  type TransactionSource
} from "./transaction-data";

const Transactions = createContext<TransactionSource | null>(null);
export function TransactionsProvider({ children }: PropsWithChildren) {
  const categories = useCategories();
  const { session, controller } = useSession();
  const preferences = usePreferences();
  const [source] = useState(() => {
    if (session.status === "demo")
      return createDemoTransactionSource(categories, (input, previous) => {
        if (previous) {
          if (
            preferences.currencyState.enabled &&
            input.currency !== previous.currency
          )
            throw new ClientFailure("validation", "CURRENCY_IMMUTABLE");
        } else {
          preferences.assertNewCurrency(input.currency);
          preferences.transactionSaved();
        }
      });
    if (session.status === "authenticated") {
      const source = createApiTransactionSource(
        controller.client(session.generation)
      );
      return {
        ...source,
        async create(input: Parameters<TransactionSource["create"]>[0]) {
          preferences.assertNewCurrency(input.currency);
          const row = await source.create(input);
          preferences.transactionSaved();
          return row;
        }
      };
    }
    throw new Error("Transactions require an application session.");
  });
  return (
    <Transactions.Provider value={source}>{children}</Transactions.Provider>
  );
}
export function useTransactions() {
  const source = useContext(Transactions);
  if (!source) throw new Error("TransactionsProvider is required.");
  return source;
}
