import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest
} from "@jest/globals";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react-native";
import * as session from "../src/session";
import {
  PreferencesProvider,
  PreferencesReady,
  usePreferences
} from "../src/preferences";
import { CurrencySettings } from "../src/currency-settings";
import { Button, Body } from "../src/ui";
import { CategoriesProvider, useCategories } from "../src/category-context";
import {
  TransactionsProvider,
  useTransactions
} from "../src/transaction-context";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useState } from "react";
import { transactionFailureMessage } from "../src/transaction-data";
import { alice, bob, deferred, harness, response } from "./auth-fixtures";

const priorFlag = process.env.EXPO_PUBLIC_FINANCE_CURRENCY_ENABLED;
beforeEach(() => {
  process.env.EXPO_PUBLIC_FINANCE_CURRENCY_ENABLED = "true";
});
afterEach(() => {
  jest.restoreAllMocks();
  if (priorFlag === undefined)
    delete process.env.EXPO_PUBLIC_FINANCE_CURRENCY_ENABLED;
  else process.env.EXPO_PUBLIC_FINANCE_CURRENCY_ENABLED = priorFlag;
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
function Probe() {
  const p = usePreferences();
  return (
    <>
      <CurrencySettings
        defaultCurrency={p.defaultCurrency}
        setDefaultCurrency={p.setDefaultCurrency}
        state={p.currencyState}
      />
      <PreferencesReady>
        <Body>Entry ready in {p.defaultCurrency}</Body>
      </PreferencesReady>
      <Button
        label="Reload saved currency"
        onPress={() => void p.currencyState.reload()}
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
              <DemoSave />
            </TransactionsProvider>
          )}
        </PreferencesProvider>
      </CategoriesProvider>
    </SafeAreaProvider>
  );
}
function DemoSave() {
  const p = usePreferences(),
    categories = useCategories(),
    transactions = useTransactions();
  const [message, setMessage] = useState("");
  const [recordedCurrency, setRecordedCurrency] = useState("");
  async function save(amountMinor: number) {
    try {
      if (!(await categories.list()).length)
        await categories.create("Demo food");
      const category = (await categories.list())[0]!;
      await transactions.create({
        categoryId: category.id,
        direction: "expense",
        currency: p.defaultCurrency,
        amountMinor,
        date: "2026-10-30",
        merchant: "Demo",
        note: null
      });
      setMessage("Demo saved");
    } catch (error) {
      setMessage(transactionFailureMessage(error));
    }
  }
  async function changeRecordedCurrency() {
    const row = (await transactions.list({})).items[0]!;
    try {
      await transactions.update(row.id, {
        direction: row.direction,
        amountMinor: row.amountMinor,
        currency: "USD",
        date: row.date,
        categoryId: row.categoryId,
        merchant: row.merchant,
        note: row.note
      });
    } catch (error) {
      setMessage(transactionFailureMessage(error));
    }
    setRecordedCurrency((await transactions.get(row.id)).currency);
  }
  return (
    <>
      <Body>{message}</Body>
      <Body>Recorded demo currency: {recordedCurrency}</Body>
      <Button label="Save a demo transaction" onPress={() => void save(101)} />
      <Button label="Attempt invalid demo save" onPress={() => void save(0)} />
      <Button
        label="Attempt demo currency edit"
        onPress={() => void changeRecordedCurrency()}
      />
    </>
  );
}

describe("persisted currency UI", () => {
  it("waits for saved preferences before exposing entry and confirms persistence after remount", async () => {
    const h = await login();
    const pending = deferred<Response>();
    let saved = "CAD";
    h.fetcher.mockImplementation(async (_url, options) => {
      if (options?.method === "PATCH")
        saved = JSON.parse(String(options.body)).entryCurrency;
      return response({
        entryCurrency: saved,
        currencyLocked: false,
        defaultAccountId: null
      });
    });
    h.fetcher.mockReturnValueOnce(pending.promise);
    const view = render(<Fixture />);
    expect(screen.queryByText(/Entry ready in/)).toBeNull();
    await act(async () => {
      pending.resolve(
        response({
          entryCurrency: "CAD",
          currencyLocked: false,
          defaultAccountId: null
        })
      );
    });
    expect(await screen.findByText("Entry ready in CAD")).toBeVisible();
    await press("Default currency KWD");
    expect(await screen.findByText("Entry ready in KWD")).toBeVisible();
    expect(
      h.fetcher.mock.calls.filter((call) => call[1]?.method === "PATCH")
    ).toHaveLength(1);
    view.unmount();
    render(<Fixture />);
    expect(await screen.findByText("Entry ready in KWD")).toBeVisible();
    expect(h.fetcher.mock.calls.at(-1)?.[0]).toContain("/v2/preferences");
  });

  it("retains the confirmed currency and requires reload after an uncertain update", async () => {
    const h = await login();
    h.fetcher.mockResolvedValue(
      response({
        entryCurrency: "CAD",
        currencyLocked: false,
        defaultAccountId: null
      })
    );
    render(<Fixture />);
    await screen.findByText("Entry ready in CAD");
    h.fetcher.mockRejectedValueOnce(new Error("private-response-data"));
    await press("Default currency USD");
    expect(screen.getByText("Default currency: CAD")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Default currency USD" })
    ).toBeDisabled();
    expect(screen.queryByText(/private-response-data/)).toBeNull();
    const writes = h.fetcher.mock.calls.filter(
      (call) => call[1]?.method === "PATCH"
    ).length;
    await press("Default currency USD");
    expect(
      h.fetcher.mock.calls.filter((call) => call[1]?.method === "PATCH")
    ).toHaveLength(writes);
    h.fetcher.mockResolvedValue(
      response({
        entryCurrency: "USD",
        currencyLocked: false,
        defaultAccountId: null
      })
    );
    await press("Reload saved currency");
    expect(await screen.findByText("Entry ready in USD")).toBeVisible();
  });

  it("does not apply a late response from a previous account", async () => {
    const first = await login();
    const pending = deferred<Response>();
    first.fetcher.mockReturnValue(pending.promise);
    const view = render(<Fixture />);
    view.unmount();
    const second = await login(bob);
    second.fetcher.mockResolvedValue(
      response({
        entryCurrency: "CAD",
        currencyLocked: false,
        defaultAccountId: null
      })
    );
    render(<Fixture />);
    await screen.findByText("Entry ready in CAD");
    await act(async () => {
      pending.resolve(
        response({
          entryCurrency: "KWD",
          currencyLocked: true,
          defaultAccountId: null
        })
      );
    });
    expect(screen.queryByText("Entry ready in KWD")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Default currency USD" })
    ).toBeEnabled();
  });

  it("locks the temporary demo on first save and retains the lock after reload", async () => {
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
    await screen.findByText("Entry ready in CAD");
    await press("Attempt invalid demo save");
    expect(
      screen.getByRole("button", { name: "Default currency EUR" })
    ).toBeEnabled();
    await press("Default currency EUR");
    await screen.findByText("Entry ready in EUR");
    await press("Save a demo transaction");
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Default currency CAD" })
      ).toBeDisabled()
    );
    await press("Attempt demo currency edit");
    expect(
      screen.getByText("A saved transaction keeps its recorded currency.")
    ).toBeVisible();
    expect(screen.getByText("Recorded demo currency: EUR")).toBeVisible();
    await press("Reload saved currency");
    expect(
      screen.getByText("Currency is locked after the first saved transaction.")
    ).toBeVisible();
    expect(h.fetcher).not.toHaveBeenCalled();
    view.unmount();
    render(<Fixture demo />);
    expect(await screen.findByText("Entry ready in CAD")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Default currency EUR" })
    ).toBeEnabled();
  });

  it("keeps the legacy rollout off without preference requests", async () => {
    process.env.EXPO_PUBLIC_FINANCE_CURRENCY_ENABLED = "false";
    const h = await login();
    const before = h.fetcher.mock.calls.length;
    render(<Fixture />);
    expect(screen.getByText("Entry ready in USD")).toBeVisible();
    await press("Default currency KWD");
    expect(screen.getByText("Entry ready in KWD")).toBeVisible();
    expect(h.fetcher.mock.calls).toHaveLength(before);
  });
});
