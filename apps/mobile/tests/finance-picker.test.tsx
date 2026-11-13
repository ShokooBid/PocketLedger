import { describe, expect, it, jest } from "@jest/globals";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react-native";
import { Modal } from "react-native";
import { AccountPicker, CategoryPicker } from "../src/finance-picker";
import {
  CategoryFailure,
  type Category,
  type CategorySource
} from "../src/category-data";
import { TransactionManagement } from "../src/transaction-management";
import { createDemoTransactionSource } from "../src/transaction-data";
import { accounts, accountId, deferred } from "./auth-fixtures";
import type { Account } from "../src/account-data";

const category = (
  id: string,
  name: string,
  parentId: string | null = null
): Category => ({
  id,
  name,
  parentId,
  isDefault: false,
  archivedAt: null
});
function fixture() {
  let rows = [
    category("root-a", "Root A"),
    category("root-b", "Root B"),
    category("child-a", "Same", "root-a"),
    category("child-b", "Same", "root-b")
  ];
  const source: CategorySource = {
    hierarchy: true,
    list: jest
      .fn<CategorySource["list"]>()
      .mockImplementation(async () => rows.map((row) => ({ ...row }))),
    recent: jest
      .fn<CategorySource["recent"]>()
      .mockImplementation(async () => [rows[3]!]),
    create: jest
      .fn<CategorySource["create"]>()
      .mockImplementation(async (name) => {
        if (!name.trim()) throw new CategoryFailure("validation");
        rows.push(category("returned-root", name));
        return "returned-root";
      }),
    createChild: jest
      .fn<NonNullable<CategorySource["createChild"]>>()
      .mockImplementation(async (name, parentId) => {
        rows.push(category("returned-child", name, parentId));
        return "returned-child";
      }),
    rename: async () => {},
    archive: async () => {}
  };
  return {
    source,
    setRows: (next: Category[]) => {
      rows = next;
    },
    getRows: () => rows
  };
}
async function press(name: string) {
  await waitFor(() =>
    expect(screen.getByRole("button", { name })).toBeEnabled()
  );
  await act(async () => {
    fireEvent.press(screen.getByRole("button", { name }));
  });
}
async function field(label: string, value: string) {
  await act(async () => {
    fireEvent.changeText(screen.getByLabelText(label), value);
  });
}
async function openCategory(source: CategorySource, selectedId = "") {
  const onSelect = jest.fn<(id: string, rows: Category[]) => void>();
  const onClose = jest.fn<() => void>();
  const view = render(
    <CategoryPicker
      source={source}
      selectedId={selectedId}
      onSelect={onSelect}
      onClose={onClose}
    />
  );
  await screen.findByLabelText("Search categories");
  return { ...view, onSelect, onClose };
}

describe("category picker", () => {
  it("shows only four active recent categories in recency order and selects a shortcut", async () => {
    const f = fixture();
    const children = Array.from({ length: 7 }, (_, index) =>
      category(`recent-${index}`, `Recent ${index}`, "root-a")
    );
    const archived = {
      ...category("archived-recent", "Archived recent", "root-a"),
      archivedAt: "2026-11-04T00:00:00Z"
    };
    f.setRows([...f.getRows(), ...children, archived]);
    const { onSelect } = await openCategory({
      ...f.source,
      recent: async () => [
        category("missing", "Missing"),
        archived,
        ...children
      ]
    });
    expect(
      screen
        .getAllByRole("button", { name: /^Recent category:/ })
        .map((button) => button.props.accessibilityLabel)
    ).toEqual([
      "Recent category: Root A / Recent 0",
      "Recent category: Root A / Recent 1",
      "Recent category: Root A / Recent 2",
      "Recent category: Root A / Recent 3"
    ]);
    expect(screen.getByText("Recent 0")).toBeVisible();
    expect(screen.queryByText("Recent category: Root A / Recent 0")).toBeNull();
    await press("Recent category: Root A / Recent 2");
    expect(onSelect).toHaveBeenCalledWith("recent-2", expect.any(Array));
  });

  it("shows the parent name once in its detail view and keeps full accessible child paths", async () => {
    const { source } = fixture();
    await openCategory(source);
    await press("Category: Root A");
    expect(screen.getAllByText("Root A")).toHaveLength(1);
    expect(screen.getByText("Same")).toBeVisible();
    expect(screen.queryByText(/Root A \/ Same/)).toBeNull();
    expect(
      screen.getByRole("button", { name: "Category: Root A / Same" })
    ).toBeVisible();
    expect(screen.getByText("Subcategories")).toBeVisible();
    await press("Back to all categories");
    expect(screen.getByLabelText("Search categories")).toBeVisible();
  });

  it("keeps long parent and child labels in the full accessible path", async () => {
    const f = fixture();
    const root = "A".repeat(100),
      child = "B".repeat(100);
    f.setRows([
      category("long-root", root),
      category("long-child", child, "long-root")
    ]);
    const view = await openCategory(
      { ...f.source, recent: async () => [] },
      "long-child"
    );
    await field("Search categories", child);
    expect(
      screen.getByRole("button", {
        name: `Category: ${root} / ${child} (selected)`,
        selected: true
      })
    ).toBeVisible();
    await press("Cancel selection");
    expect(view.onClose).toHaveBeenCalledTimes(1);
    expect(view.onSelect).not.toHaveBeenCalled();
  });

  it("opens a root without selecting it and requires the explicit parent action", async () => {
    const { source } = fixture();
    const { onSelect } = await openCategory(source, "root-a");
    expect(screen.getByText("Recently used")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Recent category: Root B / Same" })
    ).toBeVisible();
    await press("Category: Root A (selected)");
    expect(onSelect).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", {
        name: "Use this category: Root A (selected)",
        selected: true
      })
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Category: Root A / Same" })
    ).toBeVisible();
    await press("Use this category: Root A (selected)");
    expect(onSelect).toHaveBeenCalledWith("root-a", expect.any(Array));
  });

  it("searches both levels with full paths and rejects archived or missing ancestors", async () => {
    const f = fixture();
    f.setRows([
      ...f.getRows(),
      {
        ...category("old-root", "Old root"),
        archivedAt: "2026-11-04T00:00:00Z"
      },
      category("old-child", "Same", "old-root"),
      category("orphan", "Same", "missing"),
      {
        ...category("archived", "Same", "root-a"),
        archivedAt: "2026-11-04T00:00:00Z"
      }
    ]);
    const { onSelect } = await openCategory(f.source);
    await field("Search categories", "same");
    expect(
      screen.getByRole("button", { name: "Category: Root A / Same" })
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Category: Root B / Same" })
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: /Old root/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Category: Same" })).toBeNull();
    await press("Category: Root B / Same");
    expect(onSelect).toHaveBeenCalledWith("child-b", expect.any(Array));
  });

  it("blocks a child archived through its parent while the picker is open", async () => {
    const f = fixture();
    const { onSelect } = await openCategory(f.source);
    await field("Search categories", "Same");
    f.setRows(
      f
        .getRows()
        .map((row) =>
          row.id === "root-b"
            ? { ...row, archivedAt: "2026-11-04T00:00:00Z" }
            : row
        )
    );
    await press("Category: Root B / Same");
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByText(/This category is unavailable/)).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Category: Root B / Same" })
    ).toBeNull();
  });

  it("selects a new root by its returned ID even when another row has the same label", async () => {
    const { source } = fixture();
    const { onSelect } = await openCategory(source);
    await press("Add personal category");
    await field("Category name", "Root A");
    await press("Create and select category");
    expect(source.create).toHaveBeenCalledWith("Root A");
    expect(onSelect).toHaveBeenCalledWith("returned-root", expect.any(Array));
  });

  it("creates and selects a personal child under a fixed root", async () => {
    const f = fixture();
    f.setRows(
      f
        .getRows()
        .map((row) => (row.id === "root-a" ? { ...row, isDefault: true } : row))
    );
    const { onSelect } = await openCategory(f.source);
    await press("Category: Root A");
    await press("Add subcategory under Root A");
    await field("Category name", "Personal child");
    await press("Create and select category");
    expect(f.source.createChild).toHaveBeenCalledWith(
      "Personal child",
      "root-a"
    );
    expect(onSelect).toHaveBeenCalledWith("returned-child", expect.any(Array));
  });

  it("keeps invalid input and never recreates after a confirmed write and failed refresh", async () => {
    const { source } = fixture();
    const list = jest
      .fn<CategorySource["list"]>()
      .mockImplementation(() => source.list());
    const { onSelect } = await openCategory({ ...source, list });
    await press("Add personal category");
    await field("Category name", "  ");
    await press("Create and select category");
    expect(screen.getByLabelText("Category name")).toHaveProp("value", "  ");
    await field("Category name", "Saved once");
    list.mockRejectedValueOnce(new Error("offline"));
    await press("Create and select category");
    expect(onSelect).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "Create and select category" })
    ).toBeNull();
    await press("Select created category");
    expect(source.create).toHaveBeenCalledTimes(2); // One validation rejection, one confirmed create.
    expect(onSelect).toHaveBeenCalledWith("returned-root", expect.any(Array));
  });

  it("requires a read after an uncertain creation instead of offering a blind retry", async () => {
    const { source } = fixture();
    const create = jest
      .fn<CategorySource["create"]>()
      .mockRejectedValue(new CategoryFailure("uncertain"));
    await openCategory({ ...source, create });
    await press("Add personal category");
    await field("Category name", "Maybe saved");
    await press("Create and select category");
    expect(
      screen.queryByRole("button", { name: "Create and select category" })
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Add personal category" })
    ).toBeDisabled();
    await press("Reload categories");
    expect(
      screen.getByRole("button", { name: "Add personal category" })
    ).toBeEnabled();
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("recovers list reads independently of recent reads, with empty and no-result states", async () => {
    const { source } = fixture();
    const list = jest
      .fn<CategorySource["list"]>()
      .mockRejectedValueOnce(new Error("private diagnostic"))
      .mockResolvedValue([]);
    render(
      <CategoryPicker
        source={{
          ...source,
          list,
          recent: async () => {
            throw new Error("offline");
          }
        }}
        selectedId=""
        onClose={() => {}}
        onSelect={() => {}}
      />
    );
    await screen.findByText("Category selection needs attention");
    expect(screen.queryByText(/private diagnostic/)).toBeNull();
    await press("Try again");
    expect(screen.getByText("No active categories")).toBeVisible();
    expect(screen.getByText("Recent categories unavailable")).toBeVisible();
    await field("Search categories", "missing");
    expect(screen.getByText("No matching categories")).toBeVisible();
  });

  it("ignores a creation response after cancellation and a new session mounts", async () => {
    const { source } = fixture();
    const pending = deferred<string>();
    const first = await openCategory({
      ...source,
      create: () => pending.promise
    });
    await press("Add personal category");
    await field("Category name", "Late category");
    await press("Create and select category");
    await press("Cancel selection");
    expect(first.onClose).toHaveBeenCalledTimes(1);
    first.unmount();
    const next = await openCategory(source);
    await act(async () => {
      pending.resolve("returned-root");
    });
    expect(first.onSelect).not.toHaveBeenCalled();
    expect(next.onSelect).not.toHaveBeenCalled();
  });

  it("uses system Back within children and creation, and then cancels the picker", async () => {
    const { source } = fixture();
    const view = await openCategory(source);
    await press("Category: Root A");
    await press("Add subcategory under Root A");
    await act(async () => {
      fireEvent(view.UNSAFE_getByType(Modal), "requestClose");
    });
    expect(screen.queryByLabelText("Category name")).toBeNull();
    expect(view.onClose).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent(view.UNSAFE_getByType(Modal), "requestClose");
    });
    expect(screen.getByLabelText("Search categories")).toBeVisible();
    await act(async () => {
      fireEvent(view.UNSAFE_getByType(Modal), "requestClose");
    });
    expect(view.onClose).toHaveBeenCalledTimes(1);
  });
});

describe("account picker", () => {
  it("searches active compatible accounts and exposes selection through text and accessibility", async () => {
    const all = await accounts.list();
    const cad = all.find((row) => row.id === accountId("CAD"))!;
    const onSelect = jest.fn();
    render(
      <AccountPicker
        source={{
          ...accounts,
          list: async () => [
            ...all,
            {
              ...cad,
              id: "archived",
              name: "Old CAD",
              archivedAt: "2026-11-04T00:00:00Z"
            }
          ]
        }}
        currency="CAD"
        selectedId={cad.id}
        onSelect={onSelect}
        onClose={() => {}}
      />
    );
    await screen.findByRole("button", {
      name: "Account: Test CAD (selected)",
      selected: true
    });
    expect(
      screen.queryByRole("button", { name: "Account: Test USD" })
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Account: Old CAD" })
    ).toBeNull();
    await field("Search accounts", "missing");
    expect(screen.getByText("No matching accounts")).toBeVisible();
    await field("Search accounts", "test cad");
    await press("Account: Test CAD (selected)");
    expect(onSelect).toHaveBeenCalledWith(cad.id, expect.any(Array));
  });

  it("rejects an archive-while-open race and permits a Settings detour from the empty state", async () => {
    const row = (await accounts.list())[0]!;
    const list = jest
      .fn<typeof accounts.list>()
      .mockResolvedValueOnce([row])
      .mockResolvedValue([{ ...row, archivedAt: "2026-11-04T00:00:00Z" }]);
    const onSelect = jest.fn(),
      onClose = jest.fn(),
      onSettings = jest.fn();
    render(
      <AccountPicker
        source={{ ...accounts, list }}
        currency={row.currency}
        selectedId=""
        onSelect={onSelect}
        onClose={onClose}
        onSettings={onSettings}
      />
    );
    await press(`Account: ${row.name}`);
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByText("No compatible accounts")).toBeVisible();
    expect(screen.getByText(/This account is no longer active/)).toBeVisible();
    await press("Add an account in Settings");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSettings).toHaveBeenCalledTimes(1);
  });

  it("reports a read failure and ignores late selection reads after closing", async () => {
    const rows = await accounts.list();
    const pending = deferred<typeof rows>();
    const list = jest
      .fn<typeof accounts.list>()
      .mockRejectedValueOnce(new Error("private"))
      .mockResolvedValueOnce(rows)
      .mockImplementation(() => pending.promise);
    const onSelect = jest.fn(),
      onClose = jest.fn();
    const view = render(
      <AccountPicker
        source={{ ...accounts, list }}
        currency="CAD"
        selectedId=""
        onSelect={onSelect}
        onClose={onClose}
      />
    );
    await screen.findByText("Account selection needs attention");
    await press("Try again");
    await press("Account: Test CAD");
    await press("Cancel selection");
    view.unmount();
    await act(async () => {
      pending.resolve(rows);
    });
    expect(onSelect).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

it("preserves every other draft field through picker cancellation, creation and account selection", async () => {
  const { source: categories } = fixture();
  const source = createDemoTransactionSource(categories, accounts);
  render(
    <TransactionManagement
      source={source}
      categories={categories}
      accounts={accounts}
      defaultCurrency="CAD"
      initialCreate={{ date: "2026-11-01", currency: "CAD" }}
      demo
    />
  );
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Save transaction" })
    ).toBeEnabled()
  );
  await press("Income");
  await field("Amount", "12.34");
  await field("Note (optional)", "Keep my draft");
  await press("Choose category");
  await screen.findByLabelText("Search categories");
  expect(screen.queryByLabelText("Amount")).toBeNull();
  await press("Cancel selection");
  expect(screen.getByLabelText("Amount")).toHaveProp("value", "12.34");
  await press("Choose category");
  await press("Add personal category");
  await field("Category name", "New category");
  await press("Create and select category");
  expect(
    screen.getByRole("button", {
      name: "Category: New category",
      selected: true
    })
  ).toBeVisible();
  await press("Choose account");
  await press("Account: Test CAD");
  expect(screen.getByLabelText("Amount")).toHaveProp("value", "12.34");
  expect(
    screen.getByRole("button", { name: "Choose transaction date" })
  ).toHaveProp("accessibilityHint", "2026-11-01");
  expect(screen.getByLabelText("Note (optional)")).toHaveProp(
    "value",
    "Keep my draft"
  );
  expect(screen.getByText("Currency: CAD")).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Income", selected: true })
  ).toBeVisible();
  await press("Save transaction");
  await screen.findByText(/Transaction saved/);
  expect((await source.list({})).items[0]).toMatchObject({
    amountMinor: 1234,
    direction: "income",
    currency: "CAD",
    date: "2026-11-01",
    categoryId: "returned-root",
    accountId: accountId("CAD"),
    note: "Keep my draft"
  });
});

it("excludes the other transfer account and rechecks archival before accepting a selection", async () => {
  const all = await accounts.list(),
    from = all.find((row) => row.id === accountId("CAD"))!;
  const to: Account = {
    ...from,
    id: "20000000-0000-4000-8000-000000000099",
    name: "CAD savings"
  };
  let rows = [...all, to];
  const onSelect = jest.fn<(id: string, rows: Account[]) => void>();
  render(
    <AccountPicker
      source={{ ...accounts, list: async () => rows }}
      currency="CAD"
      selectedId=""
      excludeId={from.id}
      title="Choose To Account"
      onClose={() => {}}
      onSelect={onSelect}
    />
  );
  await screen.findByRole("button", { name: "Account: CAD savings" });
  expect(
    screen.queryByRole("button", { name: `Account: ${from.name}` })
  ).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Account: Test JPY" })
  ).toBeNull();
  rows = rows.map((row) =>
    row.id === to.id ? { ...row, archivedAt: new Date().toISOString() } : row
  );
  await press("Account: CAD savings");
  expect(onSelect).not.toHaveBeenCalled();
  expect(
    await screen.findByText("Account selection needs attention")
  ).toBeVisible();
});

jest.mock("expo-crypto", () => {
  let sequence = 0;
  return {
    randomUUID: () =>
      "90000000-0000-4000-8000-" + String(++sequence).padStart(12, "0")
  };
});
