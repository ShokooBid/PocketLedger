import {
  createContext,
  useContext,
  useState,
  useRef,
  type PropsWithChildren
} from "react";
import { useCategories } from "./category-context";
import { useSession } from "./session";
import { usePreferences } from "./preferences";
import { createApiTransactionSource } from "./transaction-api";
import {
  createApiAccountSource,
  createDemoFinanceSources,
  type AccountSource
} from "./account-data";
import type { TransactionSource } from "./transaction-data";

const Transactions = createContext<TransactionSource | null>(null);
const Accounts = createContext<AccountSource | null>(null);
// The session-keyed application layout discards both sources on account changes.
export function TransactionsProvider({ children }: PropsWithChildren) {
  const categories = useCategories(),
    { session, controller } = useSession(),
    preferences = usePreferences();
  const current = useRef(preferences);
  current.current = preferences;
  const [sources] = useState(() => {
    if (session.status === "demo")
      return createDemoFinanceSources(
        categories,
        () => current.current.defaultCurrency,
        (input, previous) => {
          if (!previous) {
            current.current.assertNewCurrency(input.currency);
            current.current.transactionSaved();
          }
        }
      );
    if (session.status !== "authenticated")
      throw new Error("Finance requires an application session.");
    const client = controller.client(session.generation),
      source = createApiTransactionSource(client);
    return {
      accounts: createApiAccountSource(client),
      transactions: {
        ...source,
        async create(input: Parameters<TransactionSource["create"]>[0]) {
          current.current.assertNewCurrency(input.currency);
          const row = await source.create(input);
          current.current.transactionSaved();
          return row;
        }
      }
    };
  });
  return (
    <Accounts.Provider value={sources.accounts}>
      <Transactions.Provider value={sources.transactions}>
        {children}
      </Transactions.Provider>
    </Accounts.Provider>
  );
}
export function useTransactions() {
  const source = useContext(Transactions);
  if (!source) throw new Error("TransactionsProvider is required.");
  return source;
}
export function useAccounts() {
  const source = useContext(Accounts);
  if (!source) throw new Error("TransactionsProvider is required.");
  return source;
}
