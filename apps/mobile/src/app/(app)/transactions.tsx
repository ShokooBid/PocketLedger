import { Screen } from "../../ui";
import { useCategories } from "../../category-context";
import { useTransactions } from "../../transaction-context";
import { TransactionManagement } from "../../transaction-management";
import { useSession } from "../../session";
import { useRouter } from "expo-router";

export default function TransactionsScreen() {
  const source = useTransactions();
  const categories = useCategories();
  const { session } = useSession();
  const router=useRouter();
  return (
    <Screen title="Transactions" back>
      <TransactionManagement
        source={source}
        categories={categories}
        demo={session.status === "demo"}
        onOpenDetail={id=>router.push({pathname:"/transactions/[id]",params:{id}})}
      />
    </Screen>
  );
}
