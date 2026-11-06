import { useEffect, useLayoutEffect, type PropsWithChildren } from "react";
import { AppState, Keyboard, View } from "react-native";
import { usePathname } from "expo-router";
import { usePreferences } from "./preferences";
import { useSession } from "./session";
import { useAccounts } from "./transaction-context";
import { CurrencySelection } from "./currency-settings";
import { AccountManagement } from "./account-management";
import { Body, Button, NavigationLink, Screen, StateNotice } from "./ui";

// A single route boundary covers initial URLs, back navigation and deep links.
// Keep the stack mounted while blocked so a temporary read failure or account
// repair never destroys an existing draft. Hidden screens are not accessible.
export function FinanceSetup({ children }: PropsWithChildren) {
  const preferences = usePreferences();
  const { selectedCurrency, hasActiveAccounts, currencyState } = preferences;
  const { session, controller, exitDemo } = useSession();
  const accounts = useAccounts();
  const pathname = usePathname();
  const { reload } = currencyState;
  useLayoutEffect(() => {
    void reload();
  }, [pathname, reload]);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void reload();
    });
    return () => subscription.remove();
  }, [reload]);

  const settingsOrPrivacy = pathname === "/settings" || pathname === "/privacy";
  const ready = currencyState.status === "ready" && !currencyState.saving;
  const blocked =
    !settingsOrPrivacy &&
    (!ready || selectedCurrency === null || !hasActiveAccounts);
  useEffect(() => {
    if (blocked) Keyboard.dismiss();
  }, [blocked]);
  return (
    <View style={{ flex: 1 }}>
      <View
        style={{ flex: 1, display: blocked ? "none" : "flex" }}
        accessibilityElementsHidden={blocked}
        importantForAccessibility={blocked ? "no-hide-descendants" : "auto"}
        pointerEvents={blocked ? "none" : "auto"}
      >
        {children}
      </View>
      {blocked && (
        <Screen
          title={
            selectedCurrency === null
              ? "Choose your currency"
              : hasActiveAccounts
                ? "Checking finance setup"
                : "Set up an account"
          }
        >
          {session.status === "demo" && (
            <Body>Demo setup stays in memory and resets when you exit.</Body>
          )}
          {(currencyState.status === "loading" || currencyState.saving) && (
            <StateNotice
              kind="loading"
              title="Checking finance setup"
              message="Confirming your saved currency and active accounts."
            />
          )}
          {currencyState.error && (
            <StateNotice
              kind="error"
              title="Finance setup needs attention"
              message={currencyState.error}
              onRetry={() => void reload()}
            />
          )}
          {currencyState.initialized && selectedCurrency === null && (
            <CurrencySelection
              onConfirm={preferences.setDefaultCurrency}
              disabled={!ready}
            />
          )}
          {selectedCurrency !== null && !hasActiveAccounts && (
            <>
              <Body>
                Your permanent currency is {selectedCurrency}. Create an active
                account to continue. Archived accounts and transactions are
                kept.
              </Body>
              <AccountManagement
                source={accounts}
                currency={selectedCurrency}
                defaultAccountId={preferences.defaultAccountId}
                onDefault={preferences.setDefaultAccount}
                onReloadPreferences={reload}
                preferencesReady={ready}
              />
            </>
          )}
          <NavigationLink href="/settings" label="Open settings" />
          <Button
            label={
              session.status === "demo"
                ? "Exit demo and return to sign in"
                : "Sign out"
            }
            onPress={() => {
              if (session.status === "demo") exitDemo();
              else void controller.logout();
            }}
          />
        </Screen>
      )}
    </View>
  );
}
