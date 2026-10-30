import { useLocalSearchParams, useRouter } from "expo-router";
import { z } from "zod";
import { Body, Button, Screen } from "../../../ui";
import { useCategories } from "../../../category-context";
import { useTransactions } from "../../../transaction-context";
import { useSession } from "../../../session";
import { TransactionManagement } from "../../../transaction-management";
import { PreferencesReady, usePreferences } from "../../../preferences";

export default function TransactionDetailRoute() {
  return (
    <PreferencesReady>
      <TransactionDetailScreen />
    </PreferencesReady>
  );
}
function TransactionDetailScreen() {
  const { id } = useLocalSearchParams();
  const parsed = z.uuid().safeParse(id);
  const source = useTransactions();
  const categories = useCategories();
  const { session } = useSession();
  const { currencyState } = usePreferences();
  const router = useRouter();
  return (
    <Screen title="Transaction details">
      <Button
        label="Back to previous screen"
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
          singleCurrency={currencyState.enabled}
          preferencesReady={
            !currencyState.enabled ||
            (currencyState.status === "ready" && !currencyState.saving)
          }
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
