import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SessionProvider, useSession } from "../session";
import { theme } from "../theme";
import { Screen, StateNotice } from "../ui";

export { ErrorBoundary } from "../error-boundary";

export function SessionNavigation() {
  const { session } = useSession();
  if (session.status === "restoring") {
    return (
      <Screen title="Restoring session">
        <StateNotice
          kind="loading"
          title="Preparing navigation"
          message="This shell has no saved credentials. The sign-in preview will open next."
        />
      </Screen>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: theme.color.background }
      }}
    >
      <Stack.Protected guard={session.status === "signed-out"}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
      <Stack.Protected guard={session.status === "authenticated"}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Screen name="+not-found" />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <StatusBar style="dark" />
        <SessionNavigation />
      </SessionProvider>
    </SafeAreaProvider>
  );
}
