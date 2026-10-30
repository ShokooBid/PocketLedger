import { useCallback, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import { NavigationLink, Screen } from "../../ui";
import { Dashboard } from "../../dashboard";
import {
  createApiDashboardSource,
  createDemoDashboardSource,
  monthRange
} from "../../dashboard-data";
import { useSession } from "../../session";
import { useTransactions } from "../../transaction-context";
import { useCategories } from "../../category-context";
import { PreferencesReady, usePreferences } from "../../preferences";

export default function DashboardRoute() {
  return (
    <PreferencesReady>
      <DashboardScreen />
    </PreferencesReady>
  );
}
function DashboardScreen() {
  const { session, controller } = useSession();
  const transactions = useTransactions();
  const categories = useCategories();
  const { defaultCurrency } = usePreferences();
  const router = useRouter();
  const [active, setActive] = useState(false);
  const [source] = useState(() => {
    if (session.status === "demo")
      return createDemoDashboardSource(transactions, categories);
    if (session.status === "authenticated")
      return createApiDashboardSource(
        controller.client(session.generation),
        transactions
      );
    throw new Error("Dashboard requires an application session.");
  });
  useFocusEffect(
    useCallback(() => {
      setActive(true);
      return () => setActive(false);
    }, [])
  );
  return (
    <Screen title="Dashboard">
      <Dashboard
        source={source}
        active={active}
        defaultCurrency={defaultCurrency}
        demo={session.status === "demo"}
        onAdd={({ month, currency }) =>
          router.push({
            pathname: "/transactions",
            params: { action: "add", date: monthRange(month).from, currency }
          })
        }
        onOpenDetail={(id) =>
          router.push({ pathname: "/transactions/[id]", params: { id } })
        }
      />
      <NavigationLink href="/transactions" label="View transactions" />
      <NavigationLink href="/categories" label="Manage categories" />
      <NavigationLink href="/import" label="Preview CSV import" />
      <NavigationLink href="/settings" label="Open settings" />
    </Screen>
  );
}
