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
import {
  createDemoTransferLedger,
  type TransferSource
} from "../src/transfer-data";
import { ClientFailure } from "../src/auth/transport";

let categories: CategorySource;
let source: TransactionSource;
let transfers: TransferSource;
let rows: Account[];
let policy: ReturnType<typeof preferences.usePreferences>;

beforeEach(async () => {
  rows = await accounts.list();
  categories = createDemoCategorySource({ catalog: true });
  source = createDemoTransactionSource(categories, accounts);
  let writes = Promise.resolve();
  transfers = createDemoTransferLedger(
    { list: async () => rows },
    () => "CAD",
    (action) => {
      const result = writes.then(action);
      writes = result.then(
        () => {},
        () => {}
      );
      return result;
    }
  ).source;
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
  jest.spyOn(finance, "useTransfers").mockImplementation(() => transfers);
  jest
    .spyOn(finance, "useFinanceChanges")
    .mockReturnValue({ subscribe: () => () => {}, invalidate: () => {} });
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

async function fillTransfer(entry: Awaited<ReturnType<typeof openEntry>>) {
  const from = rows.find((row) => row.id === accountId("CAD"))!;
  const to = {
    ...from,
    id: "20000000-0000-4000-8000-000000000099",
    name: "CAD savings"
  };
  rows.push(to);
  await act(async () => {
    await entry.result.current.reload();
  });
  act(() =>
    entry.result.current.change({
      direction: "transfer",
      accountId: from.id,
      toAccountId: to.id,
      amount: "25.00",
      date: "2026-11-09",
      note: "Savings move"
    })
  );
  return { from, to };
}

describe("transfer entry coordination", () => {
  it("keeps a deleted uncertain edit recoverable without creating another transfer", async () => {
    const entry = await openEntry(),
      { from, to } = await fillTransfer(entry);
    const saved = await transfers.create({
      fromAccountId: from.id,
      toAccountId: to.id,
      amountMinor: 2500,
      date: "2026-11-09",
      note: null,
      clientRequestId: "90000000-0000-4000-8000-000000000088"
    });
    act(() => entry.result.current.editTransfer(saved, () => {}));
    act(() => {
      const action = entry.result.current.leaving!.action;
      entry.result.current.setLeaving(null);
      action();
    });
    act(() => entry.result.current.change({ amount: "30" }));
    jest
      .spyOn(transfers, "update")
      .mockRejectedValue(new ClientFailure("network"));
    const create = jest.spyOn(transfers, "create");
    await act(async () => {
      await entry.result.current.save();
    });
    await act(async () => {
      await entry.result.current.save(false, true);
    });
    await transfers.remove(saved.id);
    await act(async () => {
      await entry.result.current.review();
    });
    expect(entry.result.current.uncertain).toBe(false);
    expect(entry.result.current.editingTransfer?.id).toBe(saved.id);
    expect(entry.result.current.draft.amount).toBe("30");
    expect(entry.result.current.message).toMatch(/Cancel transfer editing/);
    expect(create).not.toHaveBeenCalled();
  });
  it("reviews both accounts first, locks double confirmation and sends no category", async () => {
    const entry = await openEntry(),
      { from, to } = await fillTransfer(entry);
    const gate = deferred<void>(),
      realCreate = transfers.create;
    const create = jest
      .spyOn(transfers, "create")
      .mockImplementation(async (input) => {
        await gate.promise;
        return realCreate(input);
      });
    const normal = jest.spyOn(source, "create");
    await act(async () => {
      await entry.result.current.save();
    });
    expect(create).not.toHaveBeenCalled();
    expect(entry.result.current.confirmation).toMatchObject({
      from: { id: from.id },
      to: { id: to.id },
      input: { amountMinor: 2500 }
    });
    let saving!: Promise<void>;
    act(() => {
      saving = entry.result.current.save(false, true);
      void entry.result.current.save(false, true);
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]![0]).not.toHaveProperty("categoryId");
    expect(create.mock.calls[0]![0]).not.toHaveProperty("currency");
    await act(async () => {
      gate.resolve(undefined);
      await saving;
    });
    expect(normal).not.toHaveBeenCalled();
    expect(entry.result.current.draft).toMatchObject({
      direction: "transfer",
      accountId: from.id,
      toAccountId: to.id,
      amount: "",
      note: ""
    });
    expect(entry.result.current.savedTransfer).not.toBeNull();
  });
  it("keeps original identity through a lost response, archive, reload and explicit retry", async () => {
    const entry = await openEntry(),
      { to } = await fillTransfer(entry);
    const realCreate = transfers.create;
    const create = jest
      .spyOn(transfers, "create")
      .mockImplementationOnce(async (input) => {
        await realCreate(input);
        throw new ClientFailure("network");
      })
      .mockImplementation(realCreate);
    await act(async () => {
      await entry.result.current.save();
    });
    await act(async () => {
      await entry.result.current.save(false, true);
    });
    expect(entry.result.current.uncertain).toBe(true);
    const frozen = entry.result.current.draft;
    act(() =>
      entry.result.current.change({
        amount: "999",
        toAccountId: frozen.accountId
      })
    );
    expect(entry.result.current.draft).toEqual(frozen);
    rows = rows.map((row) =>
      row.id === to.id ? { ...row, archivedAt: new Date().toISOString() } : row
    );
    await act(async () => {
      await entry.result.current.reload();
    });
    await act(async () => {
      await entry.result.current.save(true);
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
    expect((await transfers.list()).items).toHaveLength(1);
    expect(entry.result.current.uncertain).toBe(false);
  });
  it("edits the aggregate in the same draft and reconciles a committed update without resending", async () => {
    const entry = await openEntry(),
      { from, to } = await fillTransfer(entry);
    const saved = await transfers.create({
      fromAccountId: from.id,
      toAccountId: to.id,
      amountMinor: 2500,
      date: "2026-11-09",
      note: null,
      clientRequestId: "90000000-0000-4000-8000-000000000099"
    });
    act(() => entry.result.current.requestDiscard());
    act(() => {
      const action = entry.result.current.leaving!.action;
      entry.result.current.setLeaving(null);
      action();
    });
    const navigate = jest.fn();
    act(() => entry.result.current.editTransfer(saved, navigate));
    expect(navigate).toHaveBeenCalledTimes(1);
    act(() => entry.result.current.change({ direction: "income" }));
    expect(entry.result.current.draft.direction).toBe("transfer");
    act(() =>
      entry.result.current.change({ amount: "30", note: "Edited savings" })
    );
    const realUpdate = transfers.update,
      update = jest
        .spyOn(transfers, "update")
        .mockImplementation(async (id, patch) => {
          await realUpdate(id, patch);
          throw new ClientFailure("network");
        });
    await act(async () => {
      await entry.result.current.save();
    });
    await act(async () => {
      await entry.result.current.save(false, true);
    });
    expect(entry.result.current.uncertain).toBe(true);
    await act(async () => {
      await entry.result.current.review();
    });
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0]![0]).toBe(saved.id);
    expect(update.mock.calls[0]![1]).not.toHaveProperty("clientRequestId");
    expect(entry.result.current.uncertain).toBe(false);
    expect(entry.result.current.savedTransfer).toMatchObject({
      id: saved.id,
      amountMinor: 3000
    });
  });
  it("preserves an actionable draft when an account archives during confirmation and during setup repair", async () => {
    const entry = await openEntry(),
      { to } = await fillTransfer(entry);
    const draft = entry.result.current.draft;
    await act(async () => {
      await entry.result.current.save();
    });
    rows = rows.map((row) =>
      row.id === to.id ? { ...row, archivedAt: new Date().toISOString() } : row
    );
    await act(async () => {
      await entry.result.current.save(false, true);
    });
    expect(entry.result.current.uncertain).toBe(false);
    expect(entry.result.current.draft).toEqual(draft);
    expect(entry.result.current.message).toMatch(/archived/);
    policy.hasActiveAccounts = false;
    entry.rerender({});
    expect(entry.result.current.financeReady).toBe(false);
    policy.hasActiveAccounts = true;
    entry.rerender({});
    await act(async () => {
      await entry.result.current.reload();
    });
    expect(entry.result.current.draft).toEqual(draft);
  });
  it("validates both account identities/currencies/opening dates without requiring categories", async () => {
    const entry = await openEntry(),
      { from, to } = await fillTransfer(entry),
      draft = entry.result.current.draft;
    expect(entryErrors(draft, rows, [])).toEqual({});
    expect(
      entryErrors({ ...draft, toAccountId: from.id }, rows, []).toAccountId
    ).toMatch(/different/);
    expect(
      entryErrors({ ...draft, toAccountId: accountId("JPY") }, rows, [])
        .toAccountId
    ).toMatch(/currency/);
    expect(
      entryErrors(
        draft,
        rows.map((row) =>
          row.id === to.id ? { ...row, openingDate: "2026-11-10" } : row
        ),
        []
      ).date
    ).toMatch(/2026-11-10/);
    jest
      .spyOn(categories, "list")
      .mockRejectedValue(new Error("Category read unavailable"));
    await act(async () => {
      await entry.result.current.reload();
    });
    expect(entry.result.current.ready).toBe(true);
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
