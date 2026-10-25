import { Stack } from "expo-router";
import { DemoCategoriesProvider } from "../../category-management";

export { ErrorBoundary } from "../../error-boundary";

export const unstable_settings = { anchor: "index" };

export default function AppLayout() {
  return (
    <DemoCategoriesProvider>
      <Stack screenOptions={{ headerShown: false }} />
    </DemoCategoriesProvider>
  );
}
