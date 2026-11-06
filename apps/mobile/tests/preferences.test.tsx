import { afterEach, describe, expect, it, jest } from "@jest/globals";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useState } from "react";
import * as session from "../src/session";
import {
  PreferencesProvider,
  PreferencesReady,
  usePreferences
} from "../src/preferences";
import { CurrencySettings, CurrencySelection } from "../src/currency-settings";
import { CategoriesProvider } from "../src/category-context";
import { TransactionsProvider, useAccounts } from "../src/transaction-context";
import { Body, Button } from "../src/ui";
import type { CurrencyPreferences } from "../src/preference-data";
import {
  alice,
  bob,
  deferred,
  harness,
  response,
  accountId
} from "./auth-fixtures";

let preferences!: ReturnType<typeof usePreferences>;
afterEach(() => {
  jest.restoreAllMocks();
});
async function press(name: string) {
  await act(async () => {
    fireEvent.press(screen.getByRole("button", { name }));
  });
}
async function login(user = alice) {
  const h = harness();
  h.fetcher.mockResolvedValue(response(user));
  await h.controller.restore();
  jest.spyOn(session, "useSession").mockReturnValue({
    session: h.controller.getSnapshot(),
    controller: h.controller,
    enterDemo: h.controller.enterDemo,
    exitDemo: h.controller.exitDemo
  });
  return h;
}
function Draft() {
  const [value, setValue] = useState("draft retained");
  return <Button label={value} onPress={() => setValue("draft edited")} />;
}
function Probe() {
  const p = usePreferences();
  preferences = p;
  return (
    <>
      <CurrencySettings
        defaultCurrency={p.selectedCurrency}
        state={p.currencyState}
      />
      <Body>Active accounts: {String(p.hasActiveAccounts)}</Body>
      {p.currencyState.initialized && p.selectedCurrency === null && (
        <CurrencySelection
          onConfirm={p.setDefaultCurrency}
          disabled={
            p.currencyState.status !== "ready" || p.currencyState.saving
          }
        />
      )}
      <PreferencesReady>
        <Draft />
      </PreferencesReady>
      <Button
        label="Reload saved currency"
        onPress={() => void p.currencyState.reload()}
      />
    </>
  );
}
function DemoAccounts() {
  const accounts = useAccounts();
  const p = usePreferences();
  return (
    <>
      <Button
        label="Create demo account"
        onPress={() =>
          void accounts.create({
            name: "Demo cash",
            type: "cash",
            currency: p.defaultCurrency,
            openingDate: "2026-01-01",
            openingBalanceMinor: 0
          })
        }
      />
      <Button
        label="Archive demo accounts"
        onPress={() =>
          void (async () => {
            for (const row of await accounts.list())
              await accounts.archive(row.id);
          })()
        }
      />
    </>
  );
}
function Fixture({ demo = false }: { demo?: boolean }) {
  return (
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 400, height: 800 },
        insets: { top: 0, left: 0, bottom: 0, right: 0 }
      }}
    >
      <CategoriesProvider>
        <PreferencesProvider>
          <Probe />
          {demo && (
            <TransactionsProvider>
              <DemoAccounts />
            </TransactionsProvider>
          )}
        </PreferencesProvider>
      </CategoriesProvider>
    </SafeAreaProvider>
  );
}
const empty: CurrencyPreferences = {
  entryCurrency: null,
  hasActiveAccounts: false,
  defaultAccountId: null
};

describe("permanent currency UI and provider", () => {
  it("offers CAD locally, writes once only on confirmation and persists after remount", async () => {
    const h = await login();
    let saved = empty;
    const pending = deferred<Response>();
    h.fetcher.mockImplementation(async (_url, options) => {
      if (options?.method === "PATCH")
        saved = {
          ...saved,
          entryCurrency: JSON.parse(String(options.body)).entryCurrency
        };
      return response(saved);
    });
    h.fetcher.mockReturnValueOnce(pending.promise);
    const view = render(<Fixture />);
    expect(
      screen.queryByRole("button", { name: "Confirm CAD permanently" })
    ).toBeNull();
    await act(async () => pending.resolve(response(empty)));
    await screen.findByRole("button", { name: "Confirm CAD permanently" });
    expect(
      screen.getByRole("button", {
        name: "Choose currency CAD",
        selected: true
      })
    ).toBeVisible();
    await press("Choose currency KWD");
    expect(
      h.fetcher.mock.calls.filter((c) => c[1]?.method === "PATCH")
    ).toHaveLength(0);
    await press("Confirm KWD permanently");
    expect(await screen.findByText("Default currency: KWD")).toBeVisible();
    expect(
      h.fetcher.mock.calls.filter((c) => c[1]?.method === "PATCH")
    ).toHaveLength(1);
    expect(
      screen.queryByRole("button", { name: /Choose currency/ })
    ).toBeNull();
    view.unmount();
    render(<Fixture />);
    expect(await screen.findByText("Default currency: KWD")).toBeVisible();
  });

  it("guards double confirmation and freezes controls until the response", async () => {
    const h = await login();
    h.fetcher.mockResolvedValue(response(empty));
    render(<Fixture />);
    await screen.findByRole("button", { name: "Confirm CAD permanently" });
    const pending = deferred<Response>();
    h.fetcher.mockReturnValueOnce(pending.promise);
    await press("Confirm CAD permanently");
    await press("Confirm CAD permanently");
    expect(
      screen.getByRole("button", { name: "Choose currency USD" })
    ).toBeDisabled();
    expect(
      h.fetcher.mock.calls.filter((c) => c[1]?.method === "PATCH")
    ).toHaveLength(1);
    await act(async () =>
      pending.resolve(response({ ...empty, entryCurrency: "CAD" }))
    );
    expect(await screen.findByText("Default currency: CAD")).toBeVisible();
  });

  it("requires a reload after an uncertain selection and recovers the server's saved choice", async () => {
    const h = await login();
    h.fetcher.mockResolvedValue(response(empty));
    render(<Fixture />);
    await screen.findByRole("button", { name: "Confirm CAD permanently" });
    await press("Choose currency USD");
    h.fetcher.mockRejectedValueOnce(new Error("private response data"));
    await press("Confirm USD permanently");
    expect(
      screen.getByRole("button", { name: "Confirm USD permanently" })
    ).toBeDisabled();
    expect(screen.queryByText(/private response data/)).toBeNull();
    h.fetcher.mockResolvedValue(response({ ...empty, entryCurrency: "USD" }));
    await press("Reload saved currency");
    expect(await screen.findByText("Default currency: USD")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /Choose currency/ })
    ).toBeNull();
  });

  it("keeps initialized draft components mounted on a failed refresh", async () => {
    const h = await login();
    h.fetcher.mockResolvedValue(
      response({ ...empty, entryCurrency: "CAD", hasActiveAccounts: true })
    );
    render(<Fixture />);
    await screen.findByRole("button", { name: "draft retained" });
    await press("draft retained");
    h.fetcher.mockRejectedValueOnce(new Error("offline"));
    await press("Reload saved currency");
    expect(screen.getByRole("button", { name: "draft edited" })).toBeVisible();
    expect(preferences.currencyState.status).toBe("error");
  });

  it("ignores a late response after switching users", async () => {
    const first = await login();
    const pending = deferred<Response>();
    first.fetcher.mockReturnValue(pending.promise);
    const view = render(<Fixture />);
    view.unmount();
    const second = await login(bob);
    second.fetcher.mockResolvedValue(
      response({ ...empty, entryCurrency: "CAD" })
    );
    render(<Fixture />);
    await screen.findByText("Default currency: CAD");
    await act(async () =>
      pending.resolve(response({ ...empty, entryCurrency: "KWD" }))
    );
    expect(screen.queryByText("Default currency: KWD")).toBeNull();
  });

  it("rejects failed default selection so account management cannot claim success", async () => {
    const h = await login();
    h.fetcher.mockResolvedValue(
      response({ ...empty, entryCurrency: "CAD", hasActiveAccounts: true })
    );
    render(<Fixture />);
    await waitFor(() => expect(preferences.currencyState.status).toBe("ready"));
    h.fetcher.mockResolvedValueOnce(
      response(
        { error: { code: "INVALID_ACCOUNT", message: "Unavailable" } },
        422
      )
    );
    await act(async () => {
      await expect(
        preferences.setDefaultAccount(accountId("CAD"))
      ).rejects.toBeDefined();
    });
    expect(preferences.defaultAccountId).toBeNull();
    expect(preferences.currencyState.status).toBe("error");
  });

  it("refreshes readiness again after an account mutation overtakes an older read", async () => {
    const h = await login();
    h.fetcher.mockResolvedValue(response({ ...empty, entryCurrency: "CAD" }));
    render(<Fixture />);
    await waitFor(() => expect(preferences.currencyState.status).toBe("ready"));
    const pending = deferred<Response>();
    h.fetcher.mockReturnValueOnce(pending.promise);
    let refresh!: Promise<void>;
    await act(async () => {
      void preferences.currencyState.reload();
      refresh = preferences.accountsChanged(false);
    });
    h.fetcher.mockResolvedValue(
      response({ ...empty, entryCurrency: "CAD", hasActiveAccounts: true })
    );
    await act(async () => {
      pending.resolve(response({ ...empty, entryCurrency: "CAD" }));
      await refresh;
    });
    expect(preferences.hasActiveAccounts).toBe(true);
  });

  it("uses the same permanent-choice/account rules in demo memory and resets on exit", async () => {
    const h = harness(null);
    await h.controller.restore();
    h.controller.enterDemo();
    jest.spyOn(session, "useSession").mockReturnValue({
      session: h.controller.getSnapshot(),
      controller: h.controller,
      enterDemo: h.controller.enterDemo,
      exitDemo: h.controller.exitDemo
    });
    const view = render(<Fixture demo />);
    await screen.findByRole("button", { name: "Confirm CAD permanently" });
    await press("Choose currency EUR");
    await press("Confirm EUR permanently");
    await press("Create demo account");
    await waitFor(() => expect(preferences.hasActiveAccounts).toBe(true));
    await act(async () => preferences.setDefaultCurrency("USD"));
    expect(preferences.selectedCurrency).toBe("EUR");
    await press("Reload saved currency");
    await press("Archive demo accounts");
    await waitFor(() => expect(preferences.hasActiveAccounts).toBe(false));
    expect(preferences.selectedCurrency).toBe("EUR");
    expect(h.fetcher).not.toHaveBeenCalled();
    view.unmount();
    render(<Fixture demo />);
    expect(
      await screen.findByRole("button", { name: "Confirm CAD permanently" })
    ).toBeVisible();
  });
});
