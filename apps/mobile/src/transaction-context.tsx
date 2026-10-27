import {
  createContext,
  useContext,
  useState,
  type PropsWithChildren
} from "react";
import { useCategories } from "./category-context";
import { useSession } from "./session";
import { createApiTransactionSource } from "./transaction-api";
import {
  createDemoTransactionSource,
  type TransactionSource
} from "./transaction-data";

const Transactions = createContext<TransactionSource | null>(null);
export function TransactionsProvider({ children }: PropsWithChildren) {
  const categories = useCategories();
  const { session, controller } = useSession();
  const [source] = useState(() => {
    if (session.status === "demo")
      return createDemoTransactionSource(categories);
    if (session.status === "authenticated")
      return createApiTransactionSource(controller.client(session.generation));
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
