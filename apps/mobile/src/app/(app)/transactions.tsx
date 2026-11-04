import { Screen, StateNotice } from "../../ui";
import { useCategories } from "../../category-context";
import { useTransactions, useAccounts } from "../../transaction-context";
import { TransactionManagement } from "../../transaction-management";
import { useSession } from "../../session";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { calendarDate, currencySchema } from "../../transaction-data";
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
  const { action, date, currency } = useLocalSearchParams();
  const parsedDate = calendarDate.safeParse(date);
  const parsedCurrency = currencySchema.safeParse(currency);
  const initialCreate =
    action === "add" && parsedDate.success && parsedCurrency.success
      ? { date: parsedDate.data, currency: parsedCurrency.data }
      : undefined;
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
          message="Return to the dashboard and choose Add transaction again."
        />
      </Screen>
    );
  return (
    <Screen title="Transactions" back>
      <TransactionManagement
        key={
          initialCreate
            ? `${initialCreate.date}_${initialCreate.currency}`
            : "history"
        }
        {...(initialCreate ? { initialCreate } : {})}
        defaultCurrency={defaultCurrency}
        defaultAccountId={defaultAccountId}
        accounts={accounts}
        active={active}
        preferencesReady={
          currencyState.status === "ready" && !currencyState.saving
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
