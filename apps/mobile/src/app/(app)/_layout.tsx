import { Stack } from "expo-router";
import { CategoriesProvider } from "../../category-context";
import { TransactionsProvider } from "../../transaction-context";
import { useSession } from "../../session";

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
      <TransactionsProvider>
        <Stack screenOptions={{ headerShown: false }} />
      </TransactionsProvider>
    </CategoriesProvider>
  );
}
