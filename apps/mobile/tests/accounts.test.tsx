import { expect, it, jest } from "@jest/globals";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react-native";
import { AccountManagement } from "../src/account-management";
import {
  createApiAccountSource,
  createDemoFinanceSources,
  parseOpeningBalance,
  type AccountSource
} from "../src/account-data";
import { createTransport, type FetchRequest } from "../src/auth/transport";
import { accounts, accountId, deferred, response } from "./auth-fixtures";
import { createDemoCategorySource } from "../src/category-data";
import { ClientFailure } from "../src/auth/transport";

async function press(name: string) {
  await act(async () => {
    fireEvent.press(screen.getByRole("button", { name }));
  });
}

it("parses signed opening amounts exactly without creating an income posting", () => {
  expect(parseOpeningBalance("", "CAD")).toBe(0);
  expect(parseOpeningBalance("-12.34", "CAD")).toBe(-1234);
  expect(parseOpeningBalance("-1", "JPY")).toBe(-1);
  expect(parseOpeningBalance("1.001", "KWD")).toBe(1001);
  for (const value of ["1e2", "1.001", "21474836.48", "NaN"])
    expect(() => parseOpeningBalance(value, "CAD")).toThrow();
});

it("uses canonical account paths and rejects nonadvancing pagination", async () => {
  const row = (await accounts.list()).find((row) => row.id === accountId())!;
  const fetcher = jest
    .fn<FetchRequest>()
    .mockResolvedValue(response({ items: [row], nextCursor: row.id }));
  const source = createApiAccountSource(
    createTransport("https://api.example.invalid", fetcher)
  );
  await expect(source.list()).rejects.toMatchObject({ kind: "protocol" });
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls[0]?.[0]).toContain("/v1/accounts?");
});

it("creates a named account, selects its default and confirms archival while preserving its baseline", async () => {
  const row = (await accounts.list()).find(
    (row) => row.id === accountId("CAD")
  )!;
  const create = jest.fn<AccountSource["create"]>().mockResolvedValue(row);
  const archive = jest
    .fn<AccountSource["archive"]>()
    .mockResolvedValue({ ...row, archivedAt: "2026-11-03T00:00:00Z" });
  const onDefault = jest
    .fn<(id: string | null) => Promise<void>>()
    .mockResolvedValue(undefined);
  const list = jest
    .fn<AccountSource["list"]>()
    .mockResolvedValueOnce([])
    .mockResolvedValue([row]);
  render(
    <AccountManagement
      source={{ ...accounts, list, create, archive }}
      currency="CAD"
      defaultAccountId={null}
      onDefault={onDefault}
    />
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Create account" })).toBeEnabled()
  );
  await act(async () => {
    fireEvent.changeText(screen.getByLabelText("Account name"), "My cash");
    fireEvent.changeText(
      screen.getByLabelText("Opening balance (optional)"),
      "-12.34"
    );
    fireEvent.changeText(
      screen.getByLabelText("Account opening date (YYYY-MM-DD)"),
      "2026-01-01"
    );
  });
  await press("Create account");
  expect(create).toHaveBeenCalledWith({
    name: "My cash",
    type: "bank",
    currency: "CAD",
    openingBalanceMinor: -1234,
    openingDate: "2026-01-01"
  });
  await press("Use Test CAD as default");
  expect(onDefault).toHaveBeenCalledWith(row.id);
  await press("Archive Test CAD");
  expect(archive).not.toHaveBeenCalled();
  await press("Confirm archive account");
  expect(archive).toHaveBeenCalledWith(row.id);
});

it("requires a successful account read before enabling mutations", async () => {
  const list = jest
    .fn<AccountSource["list"]>()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue([]);
  render(
    <AccountManagement
      source={{ ...accounts, list }}
      currency="CAD"
      defaultAccountId={null}
      onDefault={async () => {}}
    />
  );
  await screen.findByText(
    "Accounts could not be loaded. Reload before making changes."
  );
  expect(screen.getByRole("button", { name: "Create account" })).toBeDisabled();
  await press("Reload accounts");
  expect(screen.getByRole("button", { name: "Create account" })).toBeEnabled();
});

it("presents immutable opening information and refreshes tracked balances on focus", async () => {
  const categories = createDemoCategorySource();
  await categories.create("Food");
  const { accounts: source, transactions } = createDemoFinanceSources(
    categories,
    () => "CAD"
  );
  const row = await source.create({
    name: "BMO Chequing",
    type: "bank",
    currency: "CAD",
    openingDate: "2024-01-01",
    openingBalanceMinor: -1234
  });
  const props = {
    source,
    currency: "CAD" as const,
    defaultAccountId: null,
    onDefault: async () => {}
  };
  const view = render(<AccountManagement {...props} />);
  await screen.findByText(/BMO Chequing · CAD/);
  await press("View balance for BMO Chequing");
  expect(screen.getByText("Opening date: 2024-01-01")).toBeVisible();
  expect(screen.getByText("Opening balance: -12.34 CAD")).toBeVisible();
  expect(
    screen.getByText(/Tracked balance as of .*: -12.34 CAD/)
  ).toBeVisible();
  view.rerender(<AccountManagement {...props} active={false} />);
  await transactions.create({
    direction: "expense",
    currency: "CAD",
    amountMinor: 100,
    date: "2024-02-01",
    categoryId: (await categories.list())[0]!.id,
    accountId: row.id,
    note: null,
    clientRequestId: "90000000-0000-4000-8000-000000000001"
  });
  view.rerender(<AccountManagement {...props} active />);
  await screen.findByText(/Tracked balance as of .*: -13.34 CAD/);
  await press("Rename BMO Chequing");
  expect(screen.queryByLabelText("Opening balance (optional)")).toBeNull();
  fireEvent.changeText(screen.getByLabelText("Account name"), "BMO Savings");
  await press("Account type cash");
  await press("Save account changes");
  expect(await screen.findByText("Account details: BMO Savings")).toBeVisible();
  expect(screen.getByText("Type: cash · Status: Active")).toBeVisible();
  expect((await source.get(row.id)).openingBalanceMinor).toBe(-1234);
});

it("limits defaults to active compatible accounts and preserves archived details", async () => {
  const categories = createDemoCategorySource();
  let currency: "CAD" | "USD" = "CAD";
  const { accounts: source } = createDemoFinanceSources(
    categories,
    () => currency
  );
  const cad = await source.create({
    name: "Cash",
    type: "cash",
    currency,
    openingDate: "2024-01-01",
    openingBalanceMinor: 0
  });
  currency = "USD";
  await source.create({
    name: "CIBC",
    type: "bank",
    currency,
    openingDate: "2024-01-01",
    openingBalanceMinor: 0
  });
  const onDefault = jest
    .fn<(id: string | null) => Promise<void>>()
    .mockResolvedValue(undefined);
  const view = render(
    <AccountManagement
      source={source}
      currency="CAD"
      defaultAccountId={cad.id}
      onDefault={onDefault}
    />
  );
  await screen.findByText(/Cash · CAD/);
  expect(
    screen.queryByRole("button", { name: "Use CIBC as default" })
  ).toBeNull();
  await press("Clear default account");
  expect(onDefault).toHaveBeenLastCalledWith(null);
  await press("Archive Cash");
  expect(
    screen.getByText(
      /Future entries cannot select this account. Historical transactions and balances are preserved. If/
    )
  ).toBeVisible();
  await press("Keep account");
  expect((await source.get(cad.id)).archivedAt).toBeNull();
  await press("Archive Cash");
  await press("Confirm archive account");
  expect(onDefault).toHaveBeenLastCalledWith(null);
  view.rerender(
    <AccountManagement
      source={source}
      currency="CAD"
      defaultAccountId={null}
      onDefault={onDefault}
    />
  );
  expect(
    screen.queryByRole("button", { name: "Use Cash as default" })
  ).toBeNull();
  expect(screen.queryByRole("button", { name: "Rename Cash" })).toBeNull();
  await press("View balance for Cash");
  expect(
    screen.getByText(/Archived: .*Future entries cannot select/)
  ).toBeVisible();
  expect(screen.getByText(/Tracked balance as of .*: 0.00 CAD/)).toBeVisible();
});

it("announces loading, retains invalid values and reports name conflicts without echoing server details", async () => {
  const pending = deferred<Awaited<ReturnType<AccountSource["list"]>>>();
  const create = jest
    .fn<AccountSource["create"]>()
    .mockRejectedValue(new ClientFailure("conflict", "ACCOUNT_NAME_CONFLICT"));
  render(
    <AccountManagement
      source={{ ...accounts, list: () => pending.promise, create }}
      currency="CAD"
      defaultAccountId={null}
      onDefault={async () => {}}
    />
  );
  expect(
    screen.getByLabelText(/Loading accounts or confirming a change\./)
  ).toHaveProp("accessibilityState", { busy: true });
  expect(screen.getByRole("button", { name: "Create account" })).toBeDisabled();
  await act(async () => {
    pending.resolve([]);
  });
  await press("Create account");
  expect(create).not.toHaveBeenCalled();
  expect(screen.getByRole("alert")).toBeVisible();
  fireEvent.changeText(screen.getByLabelText("Account name"), "BMO Savings");
  await press("Create account");
  expect(
    screen.getByText(/An active account already uses that name/)
  ).toBeVisible();
  expect(screen.getByLabelText("Account name")).toHaveProp(
    "value",
    "BMO Savings"
  );
});

it("distinguishes a confirmed create followed by a failed refresh from an uncertain write", async () => {
  const row = (await accounts.list())[0]!;
  const list = jest
    .fn<AccountSource["list"]>()
    .mockResolvedValueOnce([])
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue([row]);
  const create = jest.fn<AccountSource["create"]>().mockResolvedValue(row);
  render(
    <AccountManagement
      source={{ ...accounts, list, create }}
      currency="CAD"
      defaultAccountId={null}
      onDefault={async () => {}}
    />
  );
  await screen.findByText("No financial accounts yet");
  fireEvent.changeText(screen.getByLabelText("Account name"), "Cash");
  await press("Create account");
  expect(
    screen.getByText(
      /The change was saved, but accounts could not be refreshed/
    )
  ).toBeVisible();
  expect(screen.getByRole("button", { name: "Create account" })).toBeDisabled();
  expect(
    screen.queryByRole("button", {
      name: "I reviewed accounts; enable changes"
    })
  ).toBeNull();
  await press("Reload accounts");
  expect(create).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText("Account name")).toHaveProp("value", "");
});

it("requires explicit review after an uncertain account write", async () => {
  const create = jest
    .fn<AccountSource["create"]>()
    .mockRejectedValue(new ClientFailure("network"));
  render(
    <AccountManagement
      source={{ ...accounts, create }}
      currency="CAD"
      defaultAccountId={null}
      onDefault={async () => {}}
    />
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Create account" })).toBeEnabled()
  );
  fireEvent.changeText(screen.getByLabelText("Account name"), "Cash");
  await press("Create account");
  expect(
    screen.getByRole("button", { name: "I reviewed accounts; enable changes" })
  ).toBeDisabled();
  await press("Reload accounts");
  expect(screen.getByRole("button", { name: "Create account" })).toBeDisabled();
  await press("I reviewed accounts; enable changes");
  expect(create).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Create account" })).toBeEnabled();
});

it("reports a failed default change and recovers from an unavailable detail read", async () => {
  const row = (await accounts.list())[0]!;
  const onDefault = jest
    .fn<(id: string | null) => Promise<void>>()
    .mockRejectedValue(new ClientFailure("validation", "INVALID_ACCOUNT"));
  const get = jest
    .fn<AccountSource["get"]>()
    .mockRejectedValueOnce(new ClientFailure("unavailable"))
    .mockResolvedValue({
      ...row,
      asOf: row.openingDate,
      balanceMinor: row.openingBalanceMinor
    });
  render(
    <AccountManagement
      source={{ ...accounts, get }}
      currency={row.currency}
      defaultAccountId={null}
      onDefault={onDefault}
    />
  );
  await screen.findByText(new RegExp(`${row.name} · ${row.currency}`));
  await press(`Use ${row.name} as default`);
  expect(
    screen.getByText(
      "Choose an active account in the configured currency as the default."
    )
  ).toBeVisible();
  expect(screen.queryByText(`${row.name} is the default account.`)).toBeNull();
  await press(`View balance for ${row.name}`);
  expect(screen.getByText("Tracked balance unavailable")).toBeVisible();
  await press("Reload accounts");
  expect(screen.queryByText("Tracked balance unavailable")).toBeNull();
  expect(screen.getByText(/Tracked balance as of/)).toBeVisible();
});

it("queues a focus refresh when an older balance read is still pending", async () => {
  const row = (await accounts.list())[0]!;
  const oldRead = deferred<Awaited<ReturnType<AccountSource["get"]>>>();
  const get = jest
    .fn<AccountSource["get"]>()
    .mockReturnValueOnce(oldRead.promise)
    .mockResolvedValue({ ...row, asOf: row.openingDate, balanceMinor: 200 });
  const props = {
    source: { ...accounts, get },
    currency: row.currency,
    defaultAccountId: null,
    onDefault: async () => {}
  };
  const view = render(<AccountManagement {...props} />);
  await screen.findByText(new RegExp(`${row.name} · ${row.currency}`));
  await press(`View balance for ${row.name}`);
  view.rerender(<AccountManagement {...props} active={false} />);
  view.rerender(<AccountManagement {...props} active />);
  await act(async () => {
    oldRead.resolve({ ...row, asOf: row.openingDate, balanceMinor: 100 });
  });
  await screen.findByText(/Tracked balance as of .*: 2.00 CAD/);
  expect(get).toHaveBeenCalledTimes(2);
});
