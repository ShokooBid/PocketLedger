import { Stack } from "expo-router";
import { CategoriesProvider } from "../../category-context";
import { TransactionsProvider } from "../../transaction-context";
import { PreferencesProvider } from "../../preferences";
import { useSession } from "../../session";
import { FinanceSetup } from "../../finance-setup";

export { ErrorBoundary } from "../../error-boundary";

export const unstable_settings = { anchor: "index" };

export default function AppLayout() {
  const { session } = useSession();
  if (session.status !== "demo" && session.status !== "authenticated")
    return null;
  return (
    <CategoriesProvider
      key={session.status === "demo" ? "demo" : session.generation}
    >
      <PreferencesProvider>
        <TransactionsProvider>
          <FinanceSetup>
            <Stack screenOptions={{ headerShown: false }} />
          </FinanceSetup>
        </TransactionsProvider>
      </PreferencesProvider>
    </CategoriesProvider>
  );
}
