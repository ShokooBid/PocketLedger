import { useLocalSearchParams, useRouter } from "expo-router";
import { z } from "zod";
import { Body, Button, Screen } from "../../../ui";
import { useCategories } from "../../../category-context";
import { useTransactions } from "../../../transaction-context";
import { useSession } from "../../../session";
import { TransactionManagement } from "../../../transaction-management";

export default function TransactionDetailScreen() {
  const { id } = useLocalSearchParams();
  const parsed = z.uuid().safeParse(id);
  const source = useTransactions();
  const categories = useCategories();
  const { session } = useSession();
  const router = useRouter();
  return (
    <Screen title="Transaction details">
      <Button
        label="Back to transaction history"
        onPress={() => {
          if (router.canGoBack()) router.back();
          else router.replace("/transactions");
        }}
      />
      {parsed.success ? (
        <TransactionManagement
          key={parsed.data}
          source={source}
          categories={categories}
          detailId={parsed.data}
          demo={session.status === "demo"}
        />
      ) : (
        <Body>
          This transaction link is invalid. Return to history and select a
          transaction.
        </Body>
      )}
    </Screen>
  );
}
