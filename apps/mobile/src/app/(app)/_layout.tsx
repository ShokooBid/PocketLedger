import { Link, Tabs, usePathname } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { CategoriesProvider } from "../../category-context";
import { TransactionsProvider } from "../../transaction-context";
import { PreferencesProvider } from "../../preferences";
import { useSession } from "../../session";
import { FinanceSetup } from "../../finance-setup";
import { EntryProvider, useEntry } from "../../entry-context";
import { UserMenuProvider } from "../../user-menu";
import { theme } from "../../theme";

export { ErrorBoundary } from "../../error-boundary";

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
          <EntryProvider>
            <AppScreens />
          </EntryProvider>
        </TransactionsProvider>
      </PreferencesProvider>
    </CategoriesProvider>
  );
}

function AppScreens() {
  const entry = useEntry();
  return (
    <UserMenuProvider onBeforeSignOut={entry.requestDiscard}>
      <FinanceSetup>
        <Tabs
          backBehavior="history"
          screenOptions={{ headerShown: false }}
          tabBar={() => <AppNavigation />}
        >
          <Tabs.Screen name="index" options={{ title: "Add" }} />
          <Tabs.Screen name="transactions" options={{ title: "History" }} />
          <Tabs.Screen name="overview" options={{ title: "Overview" }} />
          <Tabs.Screen name="settings" options={{ title: "Settings" }} />
          {/* This router requires every reachable tab route to be declared.
              The custom bar shows the three primary destinations; Settings is
              available from the avatar menu. Marking
              these supporting routes hidden would redirect away from them. */}
          <Tabs.Screen name="categories" />
          <Tabs.Screen name="import" />
          <Tabs.Screen name="privacy" />
          <Tabs.Screen name="transactions/[id]" />
          <Tabs.Screen name="transfers/[id]" />
        </Tabs>
      </FinanceSetup>
    </UserMenuProvider>
  );
}

function AppNavigation() {
  const pathname = usePathname();
  const entry = useEntry();
  return (
    <SafeAreaView edges={["bottom", "left", "right"]} style={styles.navigation}>
      <View style={styles.links}>
        {(
          [
            [
              "/",
              entry.editingTransaction || entry.editingTransfer
                ? "Edit"
                : "Add",
              "+"
            ],
            ["/transactions", "History", "≡"],
            ["/overview", "Overview", "◷"]
          ] as const
        ).map(([href, label, icon]) => (
          <Link
            key={href}
            href={href}
            accessibilityLabel={label}
            accessibilityState={{ selected: pathname === href }}
            style={[styles.link, pathname === href && styles.active]}
          >
            <Text accessible={false}>
              {icon}
              {"\n"}
            </Text>
            {label}
          </Link>
        ))}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  navigation: {
    backgroundColor: theme.color.surface,
    borderTopWidth: 1,
    borderTopColor: theme.color.softBorder
  },
  links: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-around",
    paddingHorizontal: 10,
    paddingVertical: 5,
    gap: 8
  },
  link: {
    flex: 1,
    minWidth: 80,
    minHeight: 56,
    textAlign: "center",
    padding: 7,
    borderRadius: 18,
    color: theme.color.muted,
    fontSize: 14,
    fontWeight: "600"
  },
  active: {
    backgroundColor: theme.color.primarySoft,
    color: theme.color.primary,
    fontWeight: "700"
  }
});
