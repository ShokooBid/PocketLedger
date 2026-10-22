import { Stack } from "expo-router";

export { ErrorBoundary } from "../../error-boundary";

export const unstable_settings = { anchor: "index" };

export default function AppLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
