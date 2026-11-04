import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { z } from "zod";
import { Body, Button, Screen } from "../../../ui";
import { useCategories } from "../../../category-context";
import { useTransactions, useAccounts } from "../../../transaction-context";
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
  const accounts = useAccounts();
  const categories = useCategories();
  const { session } = useSession();
  const { defaultCurrency, defaultAccountId, currencyState } = usePreferences();
  const router = useRouter();
  const [active, setActive] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setActive(true);
      void currencyState.reload();
      return () => setActive(false);
    }, [currencyState.reload])
  );
  const openDraftSettings = () =>
    router.push({
      pathname: "/settings",
      params: { returnTo: "transaction-draft" }
    });
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
          defaultCurrency={defaultCurrency}
          defaultAccountId={defaultAccountId}
          accounts={accounts}
          active={active}
          onAccountSettings={openDraftSettings}
          onCurrencySettings={openDraftSettings}
          preferencesReady={
            currencyState.status === "ready" && !currencyState.saving
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
