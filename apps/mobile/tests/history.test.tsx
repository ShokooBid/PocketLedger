import { describe, expect, it, jest } from "@jest/globals";
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor
} from "@testing-library/react-native";
import { createTransport } from "../src/auth/transport";
import {
  createApiHistorySource,
  historyDateLabel,
  historyKey,
  historyRecordText,
  mergeHistory,
  validateHistoryPage,
  type HistoryRow,
  type HistoryPage,
  type HistorySource,
  type HistoryFocus
} from "../src/history-data";
import { useHistory, type HistoryProps } from "../src/use-history";
import { deferred, response } from "./auth-fixtures";
import { HistoryScreen } from "../src/history-screen";

const id = (n: number) =>
  `30000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function row(n: number, extra: Partial<HistoryRow> = {}): HistoryRow {
  return {
    kind: "transaction",
    id: id(n),
    type: "expense",
    date: "2026-10-29",
    amountMinor: 100,
    currency: "CAD",
    note: null,
    accountId: id(10),
    accountName: "Cash",
    toAccountId: null,
    toAccountName: null,
    categoryId: id(20),
    categoryName: "Food",
    parentCategoryId: null,
    parentCategoryName: null,
    iconKey: "category",
    ...extra
  };
}
function page(
  items: HistoryRow[],
  extra: Partial<HistoryPage> = {}
): HistoryPage {
  return {
    items,
    days: items.length
      ? [
          {
            date: "2026-10-29",
            currency: "CAD",
            count: 4,
            incomeMinor: 0,
            expensesMinor: 400,
            netMinor: -400
          }
        ]
      : [],
    applied: {},
    adjustments: [],
    nextCursor: null,
    previousCursor: null,
    focusedKey: null,
    ...extra
  };
}
describe("History API and logical page rules", () => {
  it("labels transfer statement sides without treating them as income or expenses", () => {
    const transfer = row(2, {
      kind: "transfer",
      type: "transfer",
      categoryId: null,
      categoryName: null,
      toAccountId: id(11),
      toAccountName: "Savings"
    });
    expect(historyRecordText(transfer)).toMatchObject({
      typeLabel: "Transfer",
      amount: "CAD 1.00"
    });
    expect(historyRecordText(transfer, id(10))).toMatchObject({
      typeLabel: "Outgoing transfer",
      amount: "−CAD 1.00"
    });
    expect(historyRecordText(transfer, id(11))).toMatchObject({
      typeLabel: "Incoming transfer",
      amount: "+CAD 1.00"
    });
  });
  it("allows the authenticated transport path and preserves combined API filters", async () => {
    const filter = {
      from: "2026-10-29",
      to: "2026-10-29",
      type: "expense" as const,
      accountId: id(10),
      categoryId: id(20),
      includeSubcategories: true
    };
    const fetcher = jest
      .fn<NonNullable<Parameters<typeof createTransport>[1]>>()
      .mockResolvedValue(response(page([row(3)], { applied: filter })));
    const source = createApiHistorySource(
      createTransport("https://api.example.invalid", fetcher)
    );
    await source.list(filter);
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining("/v1/history?"),
      expect.anything()
    );
    expect(fetcher.mock.calls[0]?.[0]).toContain("includeSubcategories=true");
    expect(fetcher.mock.calls[0]?.[0]).toContain("type=expense");
    await expect(source.list({ from: "2026-10-29" })).rejects.toMatchObject({
      kind: "validation"
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("merges same-day pages without summing full-day aggregates or losing same-ID transfers", () => {
    const transfer = row(2, {
      kind: "transfer",
      type: "transfer",
      categoryId: null,
      categoryName: null,
      toAccountId: id(11),
      toAccountName: "Savings"
    });
    const first = page([row(4), row(3)], { nextCursor: historyKey(row(3)) });
    const merged = mergeHistory(first, page([transfer, row(2)]), "older");
    expect(merged.items.map((record) => `${record.kind}_${record.id}`)).toEqual(
      [
        `transaction_${id(4)}`,
        `transaction_${id(3)}`,
        `transfer_${id(2)}`,
        `transaction_${id(2)}`
      ]
    );
    expect(merged.days).toHaveLength(1);
    expect(merged.days[0]?.count).toBe(4);
    expect(first.items).toHaveLength(2);
  });
  it("supports nearer-newer pages after a backdated reveal", () => {
    const saved = row(1),
      focused = page([saved], {
        focusedKey: historyKey(saved),
        previousCursor: historyKey(saved)
      });
    const merged = mergeHistory(
      focused,
      page([row(3), row(2)], {
        previousCursor: historyKey(row(3)),
        nextCursor: historyKey(row(2))
      }),
      "newer"
    );
    expect(merged.items.map((item) => item.id)).toEqual([id(3), id(2), id(1)]);
    expect(merged.focusedKey).toBe(historyKey(saved));
    expect(merged.nextCursor).toBeNull();
  });
  it("rejects order/cursor/aggregate protocol failures before mutating loaded rows", () => {
    for (const invalid of [
      page([row(2), row(3)]),
      page([row(3), row(3)]),
      page([row(3)], { days: [] }),
      page([], { nextCursor: historyKey(row(3)) }),
      page([row(3)], { nextCursor: historyKey(row(2)) })
    ]) {
      expect(() => validateHistoryPage(invalid)).toThrow();
    }
    expect(() =>
      validateHistoryPage(page([row(3)]), { after: historyKey(row(2)) })
    ).toThrow();
    expect(historyDateLabel("2026-10-29")).toMatch(/Thu/);
  });
});

function props(source: HistorySource): HistoryProps {
  // Only read ports are exercised; no demo ledger or write implementation.
  return {
    source,
    accounts: { list: async () => [] },
    categories: { list: async () => [] },
    changes: { subscribe: () => () => {} },
    active: true,
    ready: true
  };
}
describe("History request coordination", () => {
  it("consumes account links and reapplies the same account when opened again", async () => {
    const list = jest
      .fn<HistorySource["list"]>()
      .mockImplementation(async (filter) => page([], { applied: filter }));
    const config = props({ list }),
      consumed = jest.fn();
    const hook = renderHook(
      (accountId: string | undefined) =>
        useHistory({
          ...config,
          ...(accountId ? { initialAccountId: accountId } : {}),
          onAccountConsumed: consumed
        }),
      { initialProps: id(10) as string | undefined }
    );
    await waitFor(() => expect(consumed).toHaveBeenCalledTimes(1));
    hook.rerender(undefined);
    await act(async () => hook.result.current.clear());
    await waitFor(() => expect(hook.result.current.page?.applied).toEqual({}));
    hook.rerender(id(10));
    await waitFor(() =>
      expect(hook.result.current.page?.applied.accountId).toBe(id(10))
    );
    expect(list.mock.calls.at(-1)?.[0]).toMatchObject({ accountId: id(10) });
  });
  it("clears a failed saved-record selection before returning to normal History", async () => {
    const list = jest
      .fn<HistorySource["list"]>()
      .mockRejectedValueOnce(new Error("unavailable"))
      .mockResolvedValue(page([]));
    const config = props({ list }),
      consumed = jest.fn();
    const hook = renderHook(() =>
      useHistory({
        ...config,
        focus: { id: id(1), kind: "transaction" },
        onFocusConsumed: consumed
      })
    );
    await waitFor(() => expect(hook.result.current.error).not.toBeNull());
    await act(async () => hook.result.current.clear());
    await waitFor(() => expect(hook.result.current.page?.items).toEqual([]));
    expect(consumed).toHaveBeenCalledTimes(1);
    expect(list.mock.calls[1]).toEqual([{}, {}]);
  });
  it("renders one date header with full-day counts and opens the selected logical record", async () => {
    const transfer = row(2, {
      kind: "transfer",
      type: "transfer",
      categoryId: null,
      categoryName: null,
      toAccountId: id(11),
      toAccountName: "Savings"
    });
    const config = props({ list: async () => page([row(3), transfer]) });
    const selected = jest.fn();
    render(<HistoryScreen {...config} onSelect={selected} />);
    await waitFor(() =>
      expect(
        screen.getByRole("header", { name: historyDateLabel("2026-10-29") })
      ).toBeTruthy()
    );
    expect(screen.getAllByText(/4 transactions/)).toHaveLength(1);
    fireEvent.press(
      screen.getByRole("button", {
        name: /Transfer\. Transfer\. Cash → Savings/
      })
    );
    expect(selected).toHaveBeenCalledWith(transfer);
  });
  it("ignores an older response after a confirmed finance change starts a fresh read", async () => {
    const first = deferred<HistoryPage>(),
      latest = deferred<HistoryPage>();
    const list = jest
      .fn<HistorySource["list"]>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(latest.promise);
    const config = props({ list });
    let invalidate: () => void = () => {};
    config.changes = {
      subscribe: (listener) => {
        invalidate = listener;
        return () => {};
      }
    };
    const hook = renderHook(() => useHistory(config));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
    act(() => invalidate());
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    await act(async () => latest.resolve(page([row(2)])));
    await waitFor(() =>
      expect(hook.result.current.page?.items[0]?.id).toBe(id(2))
    );
    await act(async () => first.resolve(page([row(1)])));
    expect(hook.result.current.page?.items[0]?.id).toBe(id(2));
  });
  it("retains loaded context after a failed page and retries the same cursor", async () => {
    const first = page([row(4), row(3)], { nextCursor: historyKey(row(3)) });
    const list = jest
      .fn<HistorySource["list"]>()
      .mockResolvedValueOnce(first)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(page([row(2), row(1)]));
    const config = props({ list }),
      hook = renderHook(() => useHistory(config));
    await waitFor(() => expect(hook.result.current.page).toEqual(first));
    await act(async () => hook.result.current.more("older"));
    await waitFor(() => expect(hook.result.current.error).not.toBeNull());
    expect(hook.result.current.page).toEqual(first);
    await act(async () => hook.result.current.refresh());
    await waitFor(() =>
      expect(hook.result.current.page?.items).toHaveLength(4)
    );
    expect(list.mock.calls[1]?.[1]).toEqual({ after: first.nextCursor });
    expect(list.mock.calls[2]?.[1]).toEqual({ after: first.nextCursor });
  });
  it("consumes a saved-record handoff without reloading away from its highlighted page", async () => {
    const focus: HistoryFocus = { id: id(1), kind: "transaction" };
    const focused = page([row(1)], {
      focusedKey: historyKey(row(1)),
      adjustments: ["Date range adjusted to include the saved record."]
    });
    const list = jest.fn<HistorySource["list"]>().mockResolvedValue(focused),
      config = props({ list }),
      consumed = jest.fn();
    const hook = renderHook(
      (selection: { focus?: HistoryFocus }) =>
        useHistory({ ...config, ...selection, onFocusConsumed: consumed }),
      { initialProps: { focus } as { focus?: HistoryFocus } }
    );
    await waitFor(() => expect(consumed).toHaveBeenCalledTimes(1));
    hook.rerender({});
    await act(async () => {});
    expect(list).toHaveBeenCalledTimes(1);
    expect(hook.result.current.page?.focusedKey).toBe(historyKey(row(1)));
  });
  it("does not read protected finance until the screen is active and setup is ready", async () => {
    const list = jest.fn<HistorySource["list"]>().mockResolvedValue(page([])),
      config = props({ list });
    const hook = renderHook(
      (ready: boolean) => useHistory({ ...config, ready }),
      { initialProps: false }
    );
    expect(list).not.toHaveBeenCalled();
    hook.rerender(true);
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
  });
});
