import { AccountManagement } from "../../account-management";
import { useAccounts } from "../../transaction-context";
import { useCallback, useState } from "react";
import { useSession } from "../../session";
import { Button, Screen } from "../../ui";
import Constants from "expo-constants";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { usePreferences } from "../../preferences";
import { Settings } from "../../settings";
import { useEntry } from "../../entry-context";

export { ErrorBoundary } from "../../error-boundary";

export default function SettingsScreen() {
  const { session, controller } = useSession();
  const entry = useEntry();
  const [shouldFail, setShouldFail] = useState(false);
  const preferences = usePreferences();
  const accounts = useAccounts();
  const [active, setActive] = useState(false);
  const { returnTo } = useLocalSearchParams();
  const returningToDraft = returnTo === "transaction-draft";
  const { reload } = preferences.currencyState;
  useFocusEffect(
    useCallback(() => {
      setActive(true);
      return () => setActive(false);
    }, [])
  );
  const router = useRouter();
  if (shouldFail) throw new Error("Synthetic rendering failure.");
  return (
    <Screen
      title="Settings"
      back
      {...(returningToDraft
        ? {
            backAction: {
              label: "Return to transaction draft",
              onPress: () =>
                router.canGoBack() ? router.back() : router.replace("/")
            }
          }
        : {})}
    >
      <Settings
        user={session.status === "authenticated" ? session.user : null}
        controller={controller}
        {...preferences}
        defaultCurrency={preferences.selectedCurrency}
        version={Constants.expoConfig?.version ?? "Development"}
        onPrivacy={() => router.push("/privacy")}
        onBeforeSignOut={entry.requestDiscard}
      />
      <Button
        label="Manage categories"
        onPress={() => router.push("/categories")}
      />
      {preferences.selectedCurrency !== null && (
        <AccountManagement
          source={accounts}
          currency={preferences.defaultCurrency}
          defaultAccountId={preferences.defaultAccountId}
          onDefault={preferences.setDefaultAccount}
          onReloadPreferences={reload}
          active={active}
          preferencesReady={
            preferences.currencyState.status === "ready" &&
            !preferences.currencyState.saving
          }
        />
      )}
      {session.status === "demo" && (
        <Button
          label="Preview rendering error recovery"
          hint="Shows a safe error screen. Try again will reopen Settings."
          onPress={() => setShouldFail(true)}
        />
      )}
    </Screen>
  );
}
