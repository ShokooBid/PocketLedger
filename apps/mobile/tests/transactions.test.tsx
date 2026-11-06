import { accounts, accountId, deferred } from "./auth-fixtures";
import { describe, expect, it, jest } from "@jest/globals";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react-native";
import { TransactionManagement } from "../src/transaction-management";
import {
  amountText,
  draftInput,
  createDemoTransactionSource,
  parseAmount,
  validDateFilter,
  type Currency,
  type TransactionSource
} from "../src/transaction-data";
import {
  createDemoCategorySource,
  type CategorySource
} from "../src/category-data";
import { ClientFailure } from "../src/auth/transport";
import type { AccountSource } from "../src/account-data";

it.each([
  ["CAD", "12.34", 1234],
  ["JPY", "1234", 1234],
  ["KWD", "1.234", 1234]
] as const)(
  "uses the %s account exponent and omits request currency",
  (currency, amount, expected) => {
    const account = { id: accountId(currency), currency };
    const draft = {
      direction: "expense" as const,
      amount,
      currency,
      date: "2026-11-06",
      accountId: account.id,
      categoryId: "food",
      note: ""
    };
    const input = draftInput(draft, account);
    expect(input.amountMinor).toBe(expected);
    expect(input).not.toHaveProperty("currency");
    expect(amountText(expected, currency)).toBe(amount);
    const excessivePrecision =
      currency === "JPY" ? amount + ".1" : amount + "1";
    expect(() =>
      draftInput({ ...draft, amount: excessivePrecision }, account)
    ).toThrow();
    expect(() => draftInput(draft, { ...account, currency: "USD" })).toThrow();
  }
);

it("rejects demo cross-currency moves without changing amounts and derives archived history currency", async () => {
  const categories = createDemoCategorySource();
  await categories.create("Food");
  const rows = await accounts.list();
  const accountSource = { list: async () => rows };
  const source = createDemoTransactionSource(categories, accountSource);
  const payload = {
    clientRequestId: "90000000-0000-4000-8000-000000000001",
    accountId: accountId("CAD"),
    categoryId: (await categories.list())[0]!.id,
    direction: "expense" as const,
    amountMinor: 1234,
    date: "2026-11-06",
    note: null
  };
  const saved = await source.create(payload);
  await expect(
    source.update(saved.id, { accountId: accountId("JPY"), amountMinor: 999 })
  ).rejects.toMatchObject({ code: "CURRENCY_MISMATCH" });
  rows.find((row) => row.id === saved.accountId)!.archivedAt =
    "2026-11-06T00:00:00Z";
  expect(await source.get(saved.id)).toMatchObject({
    currency: "CAD",
    amountMinor: 1234
  });
  expect(await source.create(payload)).toEqual(await source.get(saved.id));
  expect(
    await source.update(saved.id, { note: "Historical edit" })
  ).toMatchObject({ currency: "CAD", amountMinor: 1234 });
  expect((await source.list({ currency: "CAD" })).items).toHaveLength(1);
  expect((await source.list({ currency: "JPY" })).items).toEqual([]);
  await expect(
    source.create({
      ...payload,
      clientRequestId: "90000000-0000-4000-8000-000000000002"
    })
  ).rejects.toMatchObject({ code: "INVALID_ACCOUNT" });
});
async function press(name: string) {
  await act(async () => {
    await fireEvent.press(screen.getByRole("button", { name }));
  });
}
async function field(label: string, value: string) {
  await act(async () => {
    await fireEvent.changeText(screen.getByLabelText(label), value);
  });
}
async function chooseCategory(label: string) {
  await act(async () => {
    fireEvent.press(
      screen.queryByRole("button", { name: "Choose category" }) ??
        screen.getByRole("button", { name: /^Category: / })
    );
  });
  await field("Search categories", label.split(" / ").at(-1)!);
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: `Category: ${label}` })
    ).toBeEnabled()
  );
  await press(`Category: ${label}`);
  if (!label.includes(" / ")) await press(`Use this category: ${label}`);
}
async function setup(wrap?: (source: TransactionSource) => TransactionSource) {
  const categories = createDemoCategorySource();
  await categories.create("Food");
  const source =
    wrap?.(createDemoTransactionSource(categories, accounts)) ??
    createDemoTransactionSource(categories, accounts);
  render(
    <TransactionManagement
      accounts={accounts}
      defaultAccountId={accountId()}
      defaultCurrency="USD"
      source={source}
      categories={categories}
      demo
    />
  );
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Add transaction" })
    ).toBeEnabled()
  );
  return { source, categories };
}
async function fill() {
  await press("Add transaction");
  await field("Amount", "1.01");
  await field("Transaction date (YYYY-MM-DD)", "2024-02-29");
  await field("Note (optional)", "Retained note");
  await chooseCategory("Food");
}

it("refreshes choices on return, keeps every draft field and only prefills an explicitly selected default", async () => {
  const categories = createDemoCategorySource();
  await categories.create("Food");
  const owned = (await accounts.list()).filter((row) => row.currency === "USD");
  const row = owned[0]!;
  let available: typeof owned = [];
  const accountSource: AccountSource = {
    ...accounts,
    list: async () => available
  };
  const source = createDemoTransactionSource(categories, accounts);
  const props = {
    accounts: accountSource,
    source,
    categories,
    defaultCurrency: "USD" as const,
    initialCreate: { date: "2024-02-29", currency: "USD" as const },
    demo: true
  };
  const view = render(<TransactionManagement {...props} />);
  await screen.findByText("Add an account to continue");
  await field("Amount", "1.01");
  await field("Note (optional)", "Keep these values");
  await chooseCategory("Food");
  view.rerender(<TransactionManagement {...props} active={false} />);
  available = [row];
  view.rerender(
    <TransactionManagement {...props} defaultAccountId={row.id} active />
  );
  await waitFor(() =>
    expect(
      screen.getByRole("button", {
        name: `Account: ${row.name}`,
        selected: true
      })
    ).toBeVisible()
  );
  expect(screen.getByLabelText("Amount")).toHaveProp("value", "1.01");
  expect(screen.getByLabelText("Transaction date (YYYY-MM-DD)")).toHaveProp(
    "value",
    "2024-02-29"
  );
  expect(screen.getByLabelText("Note (optional)")).toHaveProp(
    "value",
    "Keep these values"
  );
  expect(
    screen.getByRole("button", {
      name: "Category: Food",
      selected: true
    })
  ).toBeVisible();
  // Clearing a default does not erase an explicit selection in an existing draft.
  await press(`Account: ${row.name}`);
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: `Account: ${row.name} (selected)` })
    ).toBeEnabled()
  );
  await press(`Account: ${row.name} (selected)`);
  view.rerender(<TransactionManagement {...props} defaultAccountId={null} />);
  await waitFor(() =>
    expect(
      screen.getByRole("button", {
        name: `Account: ${row.name}`,
        selected: true
      })
    ).toBeVisible()
  );
});

it("blocks a newly archived account and reports failed refreshes while retaining the draft", async () => {
  const categories = createDemoCategorySource();
  await categories.create("Food");
  const row = (await accounts.list()).find(
    (row) => row.id === accountId("USD")
  )!;
  const list = jest.fn<AccountSource["list"]>().mockResolvedValue([row]);
  const props = {
    accounts: { ...accounts, list },
    source: createDemoTransactionSource(categories, accounts),
    categories,
    defaultCurrency: "USD" as const,
    defaultAccountId: row.id,
    demo: true
  };
  const view = render(<TransactionManagement {...props} />);
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Add transaction" })
    ).toBeEnabled()
  );
  await fill();
  view.rerender(<TransactionManagement {...props} active={false} />);
  list.mockResolvedValue([{ ...row, archivedAt: "2026-11-04T00:00:00Z" }]);
  view.rerender(<TransactionManagement {...props} active />);
  await screen.findByText("Select an available account");
  expect(
    screen.getByRole("button", { name: "Save transaction" })
  ).toBeDisabled();
  expect(
    screen.getByText(`Selected account: ${row.name} (unavailable)`)
  ).toBeVisible();
  view.rerender(<TransactionManagement {...props} active={false} />);
  list.mockRejectedValueOnce(new Error("offline"));
  view.rerender(<TransactionManagement {...props} active />);
  await screen.findByText(
    "Accounts could not be refreshed. Your draft is preserved. Reload accounts before saving."
  );
  expect(screen.getByLabelText("Amount")).toHaveProp("value", "1.01");
  expect(screen.getByLabelText("Note (optional)")).toHaveProp(
    "value",
    "Retained note"
  );
  list.mockResolvedValue([row]);
  await press("Try again");
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Save transaction" })
    ).toBeEnabled()
  );
});
it("saves parent or child selections with unambiguous hierarchy paths in authenticated entry", async () => {
  const categories: CategorySource = {
    hierarchy: true,
    list: async () => [
      {
        id: "root-a",
        name: "Root A",
        parentId: null,
        isDefault: true,
        archivedAt: null
      },
      {
        id: "root-b",
        name: "Root B",
        parentId: null,
        isDefault: false,
        archivedAt: null
      },
      {
        id: "child-a",
        name: "Same",
        parentId: "root-a",
        isDefault: false,
        archivedAt: null
      },
      {
        id: "child-b",
        name: "Same",
        parentId: "root-b",
        isDefault: false,
        archivedAt: null
      }
    ],
    create: async () => "created-id",
    recent: async () => [],
    rename: async () => {},
    archive: async () => {}
  };
  const create = jest
    .fn<TransactionSource["create"]>()
    .mockImplementation(async (input) => ({
      ...input,
      currency: "USD",
      id: `saved-${input.categoryId}`,
      importId: null,
      createdAt: "2026-10-30T00:00:00Z",
      updatedAt: "2026-10-30T00:00:00Z"
    }));
  const source: TransactionSource = {
    create,
    list: async () => ({ items: [], nextCursor: null }),
    subscribe: () => () => {},
    get: async () => {
      throw new Error("Unused");
    },
    update: async () => {
      throw new Error("Unused");
    },
    remove: async () => {}
  };
  render(
    <TransactionManagement
      accounts={accounts}
      defaultAccountId={accountId()}
      defaultCurrency="USD"
      source={source}
      categories={categories}
      demo={false}
    />
  );
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Add transaction" })
    ).toBeEnabled()
  );
  expect(
    screen.getByRole("button", { name: "Filter category: Root A / Same" })
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Filter category: Root B / Same" })
  ).toBeVisible();
  for (const [label, id] of [
    ["Root A", "root-a"],
    ["Root B / Same", "child-b"]
  ] as const) {
    await press("Add transaction");
    await field("Amount", "1.01");
    await field("Note (optional)", "Synthetic");
    await chooseCategory(label);
    await press("Save transaction");
    expect(create).toHaveBeenLastCalledWith(
      expect.objectContaining({ categoryId: id, amountMinor: 101 })
    );
  }
});
describe("exact amount conversion", () => {
  it("validates inclusive bounded date filters as calendar dates", () => {
    expect(validDateFilter({})).toBe(true);
    expect(validDateFilter({ from: "2024-02-29", to: "2024-02-29" })).toBe(
      true
    );
    for (const filter of [
      { from: "2023-02-29", to: "2023-03-01" },
      { from: "2024-01-01" },
      { from: "2024-02-01", to: "2024-01-01" },
      { from: "2024-01-01", to: "2026-01-01" }
    ])
      expect(validDateFilter(filter)).toBe(false);
  });
  it.each([
    ["0.01", "CAD", 1],
    ["0.01", "USD", 1],
    ["1.01", "EUR", 101],
    ["21474836.47", "GBP", 2147483647],
    ["0001.2", "INR", 120],
    ["2147483647", "JPY", 2147483647],
    ["1.001", "KWD", 1001]
  ] as [string, Currency, number][])(
    "converts %s %s exactly",
    (raw, currency, expected) => {
      expect(parseAmount(raw, currency)).toBe(expected);
      expect(parseAmount(amountText(expected, currency), currency)).toBe(
        expected
      );
    }
  );
  it.each([
    "0",
    "-1",
    "1e2",
    "1,00",
    "1.001",
    "NaN",
    "Infinity",
    ".1",
    "1.",
    "21474836.48",
    " ",
    "1\n"
  ])("rejects %s", (raw) => expect(() => parseAmount(raw, "USD")).toThrow());
  it("rejects fractions for JPY and excessive KWD precision", () => {
    expect(() => parseAmount("1.1", "JPY")).toThrow();
    expect(() => parseAmount("1.0001", "KWD")).toThrow();
  });
});
describe("transaction management", () => {
  it("shows one configured currency and preserves a stale draft until explicit replacement", async () => {
    const categories = createDemoCategorySource();
    await categories.create("Food");
    const source = createDemoTransactionSource(categories, accounts);
    const onCurrencySettings = jest.fn();
    const props = {
      source,
      categories,
      onCurrencySettings
    };
    const view = render(
      <TransactionManagement
        accounts={accounts}
        defaultAccountId={accountId("CAD")}
        {...props}
        defaultCurrency="CAD"
        initialCreate={{ date: "2026-10-30", currency: "CAD" }}
      />
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Save transaction" })
      ).toBeEnabled()
    );
    await field("Amount", "12.34");
    await field("Note (optional)", "Keep my draft");
    expect(screen.getByText("Currency: CAD")).toBeVisible();
    expect(screen.queryByRole("button", { name: /^Currency / })).toBeNull();
    view.rerender(
      <TransactionManagement
        accounts={accounts}
        defaultAccountId={accountId("EUR")}
        {...props}
        defaultCurrency="EUR"
        initialCreate={{ date: "2026-10-30", currency: "CAD" }}
      />
    );
    expect(screen.getByLabelText("Amount")).toHaveProp("value", "12.34");
    expect(screen.getByLabelText("Note (optional)")).toHaveProp(
      "value",
      "Keep my draft"
    );
    expect(
      screen.getByRole("button", { name: "Save transaction" })
    ).toBeDisabled();
    await press("Keep draft and open currency settings");
    expect(onCurrencySettings).toHaveBeenCalledTimes(1);
    await press("Discard draft and start in EUR");
    expect(screen.getByText("Currency: EUR")).toBeVisible();
    expect(screen.getByLabelText("Amount")).toHaveProp("value", "");
    expect(
      screen.getByRole("button", {
        name: "Account: Test EUR",
        selected: true
      })
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Save transaction" })
    ).toBeEnabled();
    expect(await source.list({})).toMatchObject({ items: [] });
  });

  it("blocks saves during preference recovery without discarding entered values", async () => {
    const categories = createDemoCategorySource();
    await categories.create("Food");
    const source = createDemoTransactionSource(categories, accounts);
    const list = jest
      .fn<AccountSource["list"]>()
      .mockImplementation(accounts.list);
    const accountSource: AccountSource = { ...accounts, list };
    const props = {
      source,
      categories,
      defaultAccountId: accountId("CAD"),
      defaultCurrency: "CAD" as const,
      initialCreate: { date: "2026-10-30", currency: "CAD" as const }
    };
    const view = render(
      <TransactionManagement accounts={accountSource} {...props} />
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Save transaction" })
      ).toBeEnabled()
    );
    await field("Amount", "7.25");
    view.rerender(
      <TransactionManagement
        accounts={accountSource}
        {...props}
        preferencesReady={false}
      />
    );
    expect(
      screen.getByRole("button", { name: "Save transaction" })
    ).toBeDisabled();
    expect(screen.getByLabelText("Amount")).toHaveProp("value", "7.25");
    // Preference recovery starts a new account read. Control that boundary so
    // this test verifies Save cannot use account choices from before recovery.
    const pendingAccounts =
      deferred<Awaited<ReturnType<AccountSource["list"]>>>();
    list.mockReturnValueOnce(pendingAccounts.promise);
    await act(async () => {
      view.rerender(
        <TransactionManagement
          accounts={accountSource}
          {...props}
          preferencesReady
        />
      );
    });
    expect(
      screen.getByRole("button", { name: "Save transaction" })
    ).toBeDisabled();
    expect(list).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText("Amount")).toHaveProp("value", "7.25");
    await act(async () => {
      pendingAccounts.resolve(await accounts.list());
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Save transaction" })
      ).toBeEnabled()
    );
    expect(screen.getByLabelText("Amount")).toHaveProp("value", "7.25");
  });

  it("keeps a confirmed save visible without depending on another read or replaying the write", async () => {
    let create: ReturnType<typeof jest.fn<TransactionSource["create"]>>;
    await setup((source) => {
      create = jest.fn(source.create);
      return {
        ...source,
        create,
        list: jest
          .fn<TransactionSource["list"]>()
          .mockResolvedValueOnce({ items: [], nextCursor: null })
          .mockRejectedValueOnce(new ClientFailure("network"))
          .mockImplementation(source.list)
      };
    });
    await fill();
    await press("Save transaction");
    expect(screen.getByText(/1.01 USD/)).toBeVisible();
    expect(screen.queryByLabelText("Amount")).toBeNull();
    await press("Reload transactions and categories");
    expect(screen.getByText(/1.01 USD/)).toBeVisible();
    expect(screen.getByRole("alert")).toHaveProp(
      "accessibilityLabel",
      expect.stringContaining("Transactions could not be loaded")
    );
    await press("Reload transactions and categories");
    expect(create!).toHaveBeenCalledTimes(1);
  });
  it("retains invalid values, saves exact amounts, edits historical categories and confirms deletion", async () => {
    const { source, categories } = await setup();
    await fill();
    await field("Amount", "0");
    await press("Save transaction");
    expect(screen.getByLabelText("Amount")).toHaveProp("value", "0");
    expect(screen.getByRole("alert")).toBeVisible();
    await field("Amount", "1.01");
    await press("Save transaction");
    expect(screen.getByText(/1.01 USD/)).toBeVisible();
    expect((await source.list({})).items[0]).toMatchObject({
      amountMinor: 101,
      date: "2024-02-29",
      note: "Retained note"
    });
    await categories.archive((await categories.list())[0]!.id);
    await press("Reload transactions and categories");
    await press("Edit Retained note");
    expect(
      screen.getByRole("button", { name: "Category: Food (archived history)" })
    ).toBeVisible();
    await field("Note (optional)", "Edited shop");
    await press("Save transaction");
    await press("Delete Edited shop");
    await press("Keep transaction");
    expect((await source.list({})).items).toHaveLength(1);
    await press("Delete Edited shop");
    await press("Confirm delete transaction");
    expect((await source.list({})).items).toHaveLength(0);
  });
  it("retains a draft after validation failure and allows correction", async () => {
    const create = jest
      .fn<TransactionSource["create"]>()
      .mockRejectedValue(new ClientFailure("validation"));
    await setup((source) => ({ ...source, create }));
    await fill();
    await press("Save transaction");
    expect(screen.getByLabelText("Amount")).toHaveProp("value", "1.01");
    expect(screen.getByLabelText("Note (optional)")).toHaveProp(
      "value",
      "Retained note"
    );
    expect(
      screen.getByRole("button", { name: "Save transaction" })
    ).toBeEnabled();
  });
  it("blocks duplicate pending submits and retains uncertain draft until an explicit read and review", async () => {
    let reject!: (error: unknown) => void;
    const create = jest.fn<TransactionSource["create"]>(
      () =>
        new Promise((_resolve, no) => {
          reject = no;
        })
    );
    await setup((source) => ({ ...source, create }));
    await fill();
    await press("Save transaction");
    await press("Save transaction");
    expect(create).toHaveBeenCalledTimes(1);
    await act(async () => reject(new ClientFailure("network")));
    expect(screen.getByLabelText("Note (optional)")).toHaveProp(
      "value",
      "Retained note"
    );
    expect(
      screen.getByRole("button", { name: "Save transaction" })
    ).toBeDisabled();
    expect(
      screen.getByRole("button", {
        name: "Retry original save"
      })
    ).toBeDisabled();
    await press("Reload transactions and categories");
    expect(create).toHaveBeenCalledTimes(1);
    await press("Retry original save");
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1]?.[0]).toEqual(create.mock.calls[0]?.[0]);
  });
  it("shows read recovery without enabling writes until reload succeeds", async () => {
    await setup((source) => ({
      ...source,
      list: jest
        .fn<TransactionSource["list"]>()
        .mockResolvedValueOnce({ items: [], nextCursor: null })
        .mockRejectedValueOnce(new ClientFailure("network"))
        .mockResolvedValue({ items: [], nextCursor: null })
    }));
    await press("Reload transactions and categories");
    expect(
      screen.getByRole("button", { name: "Add transaction" })
    ).toBeDisabled();
    await press("Reload transactions and categories");
    expect(
      screen.getByRole("button", { name: "Add transaction" })
    ).toBeEnabled();
  });
});

jest.mock("expo-crypto", () => {
  let sequence = 0;
  return {
    randomUUID: () =>
      "90000000-0000-4000-8000-" + String(++sequence).padStart(12, "0")
  };
});
