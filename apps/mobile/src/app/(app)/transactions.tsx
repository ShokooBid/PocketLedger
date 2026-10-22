import { PlaceholderScreen } from "../../placeholder-screen";

export default function TransactionsScreen() {
  return (
    <PlaceholderScreen
      title="Transactions"
      path="/transactions"
      description="Record and review income and expenses here in a later update."
      emptyMessage="There are no demo transactions. Adding and editing records is not connected yet."
    />
  );
}
