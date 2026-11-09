import { Screen, StateNotice } from "../../ui";
import { useCategories } from "../../category-context";
import { useTransactions, useAccounts } from "../../transaction-context";
import { TransactionManagement } from "../../transaction-management";
import { useSession } from "../../session";
import {
  Redirect,
  useFocusEffect,
  useLocalSearchParams,
  useRouter
} from "expo-router";
import { parseAddLink } from "../../entry-data";
import { PreferencesReady, usePreferences } from "../../preferences";
import { useCallback, useState } from "react";

export default function TransactionsRoute() {
  return (
    <PreferencesReady>
      <TransactionsScreen />
    </PreferencesReady>
  );
}
function TransactionsScreen() {
  const source = useTransactions();
  const accounts = useAccounts();
  const categories = useCategories();
  const { session } = useSession();
  const {
    defaultCurrency,
    defaultAccountId,
    hasActiveAccounts,
    currencyState
  } = usePreferences();
  const router = useRouter();
  const [active, setActive] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setActive(true);
      void currencyState.reload();
      return () => setActive(false);
    }, [currencyState.reload])
  );
  const { action, date, currency } = useLocalSearchParams();
  const initialCreate = action === "add" ? parseAddLink(date, currency) : null;
  const openDraftSettings = () =>
    router.push({
      pathname: "/settings",
      params: { returnTo: "transaction-draft" }
    });
  if (action !== undefined && !initialCreate)
    return (
      <Screen title="Transactions" back>
        <StateNotice
          kind="error"
          title="Invalid add transaction request"
          message="Open Add to start a transaction. Your existing draft is unchanged."
        />
      </Screen>
    );
  if (initialCreate)
    return <Redirect href={{ pathname: "/", params: initialCreate }} />;
  return (
    <Screen title="History">
      <TransactionManagement
        onAdd={() => router.navigate("/")}
        defaultCurrency={defaultCurrency}
        defaultAccountId={defaultAccountId}
        accounts={accounts}
        active={active}
        preferencesReady={
          currencyState.status === "ready" &&
          !currencyState.saving &&
          hasActiveAccounts
        }
        onCurrencySettings={openDraftSettings}
        onAccountSettings={openDraftSettings}
        source={source}
        categories={categories}
        demo={session.status === "demo"}
        onOpenDetail={(id) =>
          router.push({ pathname: "/transactions/[id]", params: { id } })
        }
      />
    </Screen>
  );
}
