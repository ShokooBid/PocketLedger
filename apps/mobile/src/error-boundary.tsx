import { type ErrorBoundaryProps } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Screen, StateNotice } from "./ui";

// Expo Router invokes this for render failures and remounts the route on retry.
// Do not display or log the error: future errors may contain private data.
export function ErrorBoundary({ retry }: ErrorBoundaryProps) {
  return (
    <SafeAreaProvider>
      <Screen title="Something went wrong">
        <StateNotice
          kind="error"
          title="This screen could not be displayed"
          message="Try again to reopen the screen. If the problem continues, restart the app."
          onRetry={() => void retry()}
        />
      </Screen>
    </SafeAreaProvider>
  );
}
