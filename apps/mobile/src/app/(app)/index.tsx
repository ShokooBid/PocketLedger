import { TransactionEntry } from "../../transaction-entry";

// Readiness is enforced once by FinanceSetup in the application layout.
export default function AddRoute() {
  return <TransactionEntry />;
}
