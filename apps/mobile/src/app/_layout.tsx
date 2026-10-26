import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SessionProvider, useSession } from "../session";
import { theme } from "../theme";
import { Button, Screen, StateNotice } from "../ui";
import { ClientFailure, failureMessage } from "../auth/transport";

export { ErrorBoundary } from "../error-boundary";

export function SessionNavigation() {
  const { session, controller } = useSession();
  if (session.status === "restoring" || session.status === "signing-out") {
    return (
      <Screen title="Restoring session">
        <StateNotice
          kind="loading"
          title="Preparing navigation"
          message="Checking secure session state before continuing."
        />
      </Screen>
    );
  }
  if (session.status === "unavailable") {
    return (
      <Screen title="Session unavailable">
        <StateNotice
          kind="error"
          title="Cannot restore your session"
          message={failureMessage(new ClientFailure(session.reason))}
          {...(session.reason === "ambiguous"
            ? {}
            : {
                onRetry: () => {
                  void controller.restore();
                }
              })}
        />
        <Button
          label="Clear session and return to sign in"
          onPress={() => {
            void controller.logout();
          }}
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
      <Stack.Protected
        guard={session.status === "authenticated" || session.status === "demo"}
      >
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
