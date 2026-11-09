import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest
} from "@jest/globals";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import * as finance from "../src/transaction-context";
import * as categoryContext from "../src/category-context";
import * as preferences from "../src/preferences";
import { EntryProvider, useEntry } from "../src/entry-context";
import {
  entryErrors,
  freshEntry,
  keypadAmount,
  localDate,
  parseAddLink
} from "../src/entry-data";
import {
  createDemoCategorySource,
  type CategorySource
} from "../src/category-data";
import {
  createDemoTransactionSource,
  type TransactionSource
} from "../src/transaction-data";
import { accounts, accountId, deferred } from "./auth-fixtures";
import type { Account } from "../src/account-data";

let categories: CategorySource;
let source: TransactionSource;
let rows: Account[];
let policy: ReturnType<typeof preferences.usePreferences>;

beforeEach(async () => {
  rows = await accounts.list();
  categories = createDemoCategorySource({ catalog: true });
  source = createDemoTransactionSource(categories, accounts);
  policy = {
    selectedCurrency: "CAD",
    defaultCurrency: "CAD",
    defaultAccountId: accountId("CAD"),
    hasActiveAccounts: true,
    currencyState: {
      initialized: true,
      status: "ready",
      saving: false,
      error: null,
      reload: async () => {}
    },
    setDefaultAccount: async () => {},
    setDefaultCurrency: async () => {},
    assertNewCurrency: () => {},
    accountsChanged: async () => {}
  };
  jest
    .spyOn(finance, "useAccounts")
    .mockReturnValue({ ...accounts, list: async () => rows });
  jest.spyOn(finance, "useTransactions").mockImplementation(() => source);
  jest.spyOn(categoryContext, "useCategories").mockReturnValue(categories);
  jest.spyOn(preferences, "usePreferences").mockImplementation(() => policy);
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

async function openEntry() {
  const hook = renderHook(() => useEntry(), { wrapper: EntryProvider });
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  return hook;
}
async function fillEntry(entry: Awaited<ReturnType<typeof openEntry>>) {
  const categoryId = (await categories.list())[0]!.id;
  act(() =>
    entry.result.current.change({
      amount: "12.34",
      note: "Synthetic lunch",
      categoryId,
      date: "2026-11-09"
    })
  );
}

describe("entry keypad and external links", () => {
  it("rejects arithmetic, duplicate dots, excessive decimals and overflow without rounding", () => {
    expect(keypadAmount("", ".", "CAD")).toBe("0.");
    expect(keypadAmount("0", "7", "CAD")).toBe("7");
    expect(keypadAmount("1.23", "4", "CAD")).toBe("1.23");
    expect(keypadAmount("1.2", ".", "CAD")).toBe("1.2");
    expect(keypadAmount("1", ".", "JPY")).toBe("1");
    expect(keypadAmount("1.23", "4", "KWD")).toBe("1.234");
    expect(keypadAmount("21474836.4", "8", "CAD")).toBe("21474836.4");
    expect(keypadAmount("12", "+", "CAD")).toBe("12");
    expect(keypadAmount("12", "backspace", "CAD")).toBe("1");
  });
  it("uses local calendar fields and rejects malformed or array link parameters", () => {
    const date = new Date(2026, 10, 9, 0, 1);
    expect(localDate(date)).toBe("2026-11-09");
    expect(parseAddLink("2024-02-29", "KWD")).toEqual({
      date: "2024-02-29",
      currency: "KWD"
    });
    expect(parseAddLink("2025-02-29", "CAD")).toBeNull();
    expect(parseAddLink(["2026-11-09"], "CAD")).toBeNull();
    expect(parseAddLink(undefined, undefined)).toEqual({});
  });
  it("reports account, category, amount, date and note errors separately", async () => {
    const draft = {
      ...freshEntry("CAD"),
      amount: "0",
      date: "2026-02-30",
      note: "bad\ncontrol"
    };
    expect(
      Object.keys(entryErrors(draft, rows, await categories.list()))
    ).toEqual(["accountId", "amount", "categoryId", "date", "note"]);
  });
});

describe("session entry coordination", () => {
  it("guards rapid submits and clears only amount/note after confirmation", async () => {
    const pending =
      deferred<Awaited<ReturnType<TransactionSource["create"]>>>();
    const create = jest
      .spyOn(source, "create")
      .mockReturnValue(pending.promise);
    const entry = await openEntry();
    await fillEntry(entry);
    let saving!: Promise<void>;
    act(() => {
      saving = entry.result.current.save();
      void entry.result.current.save();
    });
    expect(create).toHaveBeenCalledTimes(1);
    const payload = create.mock.calls[0]![0];
    expect(payload).toMatchObject({
      amountMinor: 1234,
      note: "Synthetic lunch",
      accountId: accountId("CAD")
    });
    expect(payload).not.toHaveProperty("currency");
    const { clientRequestId: _identity, ...fields } = payload;
    await act(async () => {
      pending.resolve({
        ...fields,
        id: "90000000-0000-4000-8000-000000000001",
        currency: "CAD",
        importId: null,
        createdAt: "2026-11-09T00:00:00Z",
        updatedAt: "2026-11-09T00:00:00Z"
      });
      await saving;
    });
    expect(entry.result.current.draft).toMatchObject({
      amount: "",
      note: "",
      date: "2026-11-09",
      categoryId: payload.categoryId,
      accountId: payload.accountId
    });
    expect(entry.result.current.uncertain).toBe(false);
    expect(_identity).toMatch(/^[0-9a-f-]{36}$/i);
  });
  it("freezes uncertain identity/payload through reloads and retries the original create", async () => {
    const realCreate = source.create;
    const create = jest
      .spyOn(source, "create")
      .mockImplementationOnce(async () => {
        throw new Error("offline");
      })
      .mockImplementation(realCreate);
    const entry = await openEntry();
    await fillEntry(entry);
    await act(async () => {
      await entry.result.current.save();
    });
    expect(entry.result.current.uncertain).toBe(true);
    act(() => entry.result.current.change({ amount: "999" }));
    expect(entry.result.current.draft.amount).toBe("12.34");
    await act(async () => {
      await entry.result.current.reload();
      await entry.result.current.save();
    });
    expect(create).toHaveBeenCalledTimes(1);
    await act(async () => {
      await entry.result.current.review();
    });
    await act(async () => {
      await entry.result.current.save(true);
    });
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1]![0]).toEqual(create.mock.calls[0]![0]);
  });
  it("preserves dirty drafts through repair and refuses stale currency links", async () => {
    const entry = await openEntry();
    await fillEntry(entry);
    const before = entry.result.current.draft;
    act(() =>
      entry.result.current.applyLink({ date: "2024-01-01", currency: "JPY" })
    );
    expect(entry.result.current.draft).toEqual(before);
    policy.hasActiveAccounts = false;
    entry.rerender({});
    expect(entry.result.current.financeReady).toBe(false);
    policy.hasActiveAccounts = true;
    entry.rerender({});
    await act(async () => {
      await entry.result.current.reload();
    });
    expect(entry.result.current.draft).toEqual(before);
  });
  it("requires explicit confirmation before discarding or signing out", async () => {
    const entry = await openEntry();
    await fillEntry(entry);
    const logout = jest.fn();
    act(() => entry.result.current.requestDiscard(logout));
    expect(logout).not.toHaveBeenCalled();
    expect(entry.result.current.leaving).not.toBeNull();
    act(() => entry.result.current.setLeaving(null));
    expect(entry.result.current.draft.amount).toBe("12.34");
  });
  it("keeps a manually chosen date across midnight and clears all draft state on a new session", async () => {
    jest.useFakeTimers({ now: new Date(2026, 10, 9, 23, 59, 50) });
    const entry = await openEntry();
    expect(entry.result.current.draft.date).toBe("2026-11-09");
    act(() => jest.advanceTimersByTime(30_000));
    expect(entry.result.current.draft.date).toBe("2026-11-10");
    act(() => entry.result.current.change({ date: "2024-02-29", amount: "5" }));
    act(() => jest.advanceTimersByTime(86_400_000));
    expect(entry.result.current.draft.date).toBe("2024-02-29");
    entry.unmount();
    const next = await openEntry();
    expect(next.result.current.draft.amount).toBe("");
    expect(next.result.current.uncertain).toBe(false);
  });
});

// The Expo Jest preset stubs native crypto; supply real-shaped, distinct request
// identities just as the transaction and navigation suites do. Production still
// uses expo-crypto rather than this deterministic test double.
jest.mock("expo-crypto", () => {
  let sequence = 0;
  return {
    randomUUID: () =>
      "90000000-0000-4000-8000-" + String(++sequence).padStart(12, "0")
  };
});
