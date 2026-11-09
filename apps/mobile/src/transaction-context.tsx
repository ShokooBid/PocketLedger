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
import { ClientFailure } from "./auth/transport";
import { createApiTransferSource, type TransferSource } from "./transfer-data";

const Transactions = createContext<TransactionSource | null>(null);
const Accounts = createContext<AccountSource | null>(null);
const Transfers = createContext<TransferSource | null>(null);
// The session-keyed application layout discards both sources on account changes.
export function TransactionsProvider({ children }: PropsWithChildren) {
  const categories = useCategories(),
    { session, controller } = useSession(),
    preferences = usePreferences();
  const current = useRef(preferences);
  current.current = preferences;
  const [sources] = useState(() => {
    const selectedCurrency = () => {
      const currency = current.current.selectedCurrency;
      if (currency === null)
        throw new ClientFailure("validation", "CURRENCY_REQUIRED");
      return currency;
    };
    if (session.status === "demo")
      return createDemoFinanceSources(
        categories,
        selectedCurrency,
        (currency, previous) => {
          if (!previous) {
            current.current.assertNewCurrency(currency);
          }
        }
      );
    if (session.status !== "authenticated")
      throw new Error("Finance requires an application session.");
    const client = controller.client(session.generation),
      source = createApiTransactionSource(client),
      transfers = createApiTransferSource(client);
    return {
      accounts: createApiAccountSource(client),
      transfers: {
        ...transfers,
        async create(input: Parameters<TransferSource["create"]>[0]) {
          current.current.assertNewCurrency(selectedCurrency());
          return transfers.create(input);
        }
      },
      transactions: {
        ...source,
        async create(input: Parameters<TransactionSource["create"]>[0]) {
          current.current.assertNewCurrency(selectedCurrency());
          return source.create(input);
        }
      }
    };
  });
  const [accounts] = useState<AccountSource>(() => {
    async function changed() {
      const active =
        session.status === "demo"
          ? (await sources.accounts.list()).some((row) => !row.archivedAt)
          : false; // API reload derives readiness from its database snapshot.
      await current.current.accountsChanged(active);
    }
    return {
      ...sources.accounts,
      async create(input) {
        const row = await sources.accounts.create(input);
        await changed();
        return row;
      },
      async update(id, patch) {
        const row = await sources.accounts.update(id, patch);
        await changed();
        return row;
      },
      async archive(id) {
        const row = await sources.accounts.archive(id);
        await changed();
        return row;
      }
    };
  });
  return (
    <Accounts.Provider value={accounts}>
      <Transactions.Provider value={sources.transactions}>
        <Transfers.Provider value={sources.transfers}>
          {children}
        </Transfers.Provider>
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
export function useTransfers() {
  const source = useContext(Transfers);
  if (!source) throw new Error("TransactionsProvider is required.");
  return source;
}
