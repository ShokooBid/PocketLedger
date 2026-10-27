import { Screen } from "../../ui";
import { useCategories } from "../../category-context";
import { useTransactions } from "../../transaction-context";
import { TransactionManagement } from "../../transaction-management";
import { useSession } from "../../session";

export default function TransactionsScreen() {
  const source = useTransactions();
  const categories = useCategories();
  const { session } = useSession();
  return (
    <Screen title="Transactions" back>
      <TransactionManagement
        source={source}
        categories={categories}
        demo={session.status === "demo"}
      />
    </Screen>
  );
}
