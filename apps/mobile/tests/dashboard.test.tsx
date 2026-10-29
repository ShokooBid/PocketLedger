import { afterEach, describe, expect, it, jest } from "@jest/globals";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react-native";
import { Dashboard } from "../src/dashboard";
import {
  monthRange,
  type DashboardSource,
  type DashboardSummary
} from "../src/dashboard-data";
import { deferred } from "./auth-fixtures";

const categoryId = "20000000-0000-4000-8000-000000000001";
const transactionId = "30000000-0000-4000-8000-000000000001";
function fixture(
  month = "2026-10",
  incomeMinor = 2050,
  expensesMinor = 250
): DashboardSummary {
  return {
    ...monthRange(month),
    currency: "USD",
    incomeMinor,
    expensesMinor,
    netMinor: incomeMinor - expensesMinor,
    categoryBreakdown: [
      {
        categoryId,
        categoryName: "Food",
        incomeMinor,
        expensesMinor,
        netMinor: incomeMinor - expensesMinor
      }
    ],
    recentTransactions: [
      {
        id: transactionId,
        categoryId,
        direction: "expense",
        amountMinor: 250,
        currency: "USD",
        date: `${month}-01`,
        merchant: "Synthetic shop",
        note: null,
        createdAt: "2026-10-01T00:00:00Z",
        updatedAt: "2026-10-01T00:00:00Z"
      }
    ]
  };
}
function source() {
  let changed: () => void = () => {};
  const unsubscribe = jest.fn();
  const data: DashboardSource = {
    summary: jest.fn<DashboardSource["summary"]>().mockResolvedValue(fixture()),
    subscribe: jest.fn((listener: () => void) => {
      changed = listener;
      return unsubscribe;
    })
  };
  return {
    data,
    summary: jest.mocked(data.summary),
    change: () => changed(),
    unsubscribe
  };
}
async function press(name: string) {
  await act(async () => {
    fireEvent.press(screen.getByRole("button", { name }));
  });
}
afterEach(() => {
  jest.restoreAllMocks();
});
describe("monthly dashboard", () => {
  it("renders fixture totals, labeled category spending and recent detail navigation", async () => {
    const h = source();
    const onOpenDetail = jest.fn();
    const onAdd = jest.fn();
    render(
      <Dashboard
        source={h.data}
        initialMonth="2026-10"
        onAdd={onAdd}
        onOpenDetail={onOpenDetail}
      />
    );
    expect(await screen.findByLabelText("Income. USD 20.50")).toBeVisible();
    expect(screen.getByLabelText("Expenses. USD 2.50")).toBeVisible();
    expect(screen.getByLabelText("Net surplus. USD 18.00")).toBeVisible();
    expect(screen.getByLabelText("Food. Expenses: USD 2.50")).toBeVisible();
    await press("View Synthetic shop on 2026-10-01");
    expect(onOpenDetail).toHaveBeenCalledWith(transactionId);
    await press("Add transaction");
    expect(onAdd).toHaveBeenCalledWith({ month: "2026-10", currency: "USD" });
  });
  it("explains empty months with zero totals and an add action", async () => {
    const h = source();
    h.summary.mockResolvedValue({
      ...fixture(),
      incomeMinor: 0,
      expensesMinor: 0,
      netMinor: 0,
      categoryBreakdown: [],
      recentTransactions: []
    });
    const add = jest.fn();
    render(
      <Dashboard
        source={h.data}
        initialMonth="2026-10"
        onAdd={add}
        onOpenDetail={jest.fn()}
        demo
      />
    );
    expect(await screen.findByText("No transactions this month")).toBeVisible();
    expect(screen.getByLabelText("Net balanced. USD 0.00")).toBeVisible();
    expect(screen.getByText(/Demo only/)).toBeVisible();
    await press("Add transaction");
    expect(add).toHaveBeenCalledTimes(1);
  });
  it("announces pending work, uses safe API errors and retries without logging financial data", async () => {
    const h = source();
    const pending = deferred<DashboardSummary>();
    h.summary.mockReturnValueOnce(pending.promise);
    const errorLog = jest.spyOn(console, "error").mockImplementation(() => {});
    const warningLog = jest.spyOn(console, "warn").mockImplementation(() => {});
    render(
      <Dashboard
        source={h.data}
        initialMonth="2026-10"
        onAdd={jest.fn()}
        onOpenDetail={jest.fn()}
      />
    );
    expect(screen.getByLabelText(/Loading summary\./)).toHaveProp(
      "accessibilityState",
      { busy: true }
    );
    await act(async () => {
      pending.reject(new Error("private financial amount 123456.78"));
    });
    expect(screen.getByRole("alert")).toBeVisible();
    expect(screen.queryByText(/123456/)).toBeNull();
    expect(errorLog).not.toHaveBeenCalled();
    expect(warningLog).not.toHaveBeenCalled();
    await press("Try again");
    expect(await screen.findByLabelText("Income. USD 20.50")).toBeVisible();
  });
  it("ignores a late result and late error when months change rapidly", async () => {
    const h = source();
    const first = deferred<DashboardSummary>();
    const second = deferred<DashboardSummary>();
    h.summary
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockResolvedValueOnce(fixture("2026-12", 0, 100));
    render(
      <Dashboard
        source={h.data}
        initialMonth="2026-10"
        onAdd={jest.fn()}
        onOpenDetail={jest.fn()}
      />
    );
    await press("Next month");
    await press("Next month");
    expect(
      await screen.findByLabelText("Net deficit. USD -1.00")
    ).toBeVisible();
    await act(async () => {
      first.resolve(fixture());
      second.reject(new Error("late failure"));
    });
    expect(screen.getByText("December 2026 · USD")).toBeVisible();
    expect(screen.getByLabelText("Net deficit. USD -1.00")).toBeVisible();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByLabelText("Income. USD 20.50")).toBeNull();
  });
  it("clears old values on currency changes and validates the typed month", async () => {
    const h = source();
    const pending = deferred<DashboardSummary>();
    render(
      <Dashboard
        source={h.data}
        initialMonth="2026-10"
        onAdd={jest.fn()}
        onOpenDetail={jest.fn()}
      />
    );
    await screen.findByLabelText("Income. USD 20.50");
    await press("Choose month");
    await act(async () => {
      fireEvent.changeText(screen.getByLabelText("Month (YYYY-MM)"), "2026-13");
    });
    await press("Show selected month");
    expect(screen.getByText("Check the month")).toBeVisible();
    expect(h.summary).toHaveBeenCalledTimes(1);
    h.summary.mockReturnValueOnce(pending.promise);
    await press("Change currency (USD)");
    await press("Summary currency JPY");
    expect(screen.queryByLabelText("Income. USD 20.50")).toBeNull();
    expect(h.summary).toHaveBeenLastCalledWith({
      month: "2026-10",
      currency: "JPY"
    });
    await act(async () => {
      pending.resolve({
        ...fixture(),
        currency: "JPY",
        incomeMinor: 0,
        expensesMinor: 0,
        netMinor: 0,
        categoryBreakdown: [],
        recentTransactions: []
      });
    });
    expect(screen.getByLabelText("Net balanced. JPY 0")).toBeVisible();
    await act(async () => {
      fireEvent.changeText(screen.getByLabelText("Month (YYYY-MM)"), "2024-02");
    });
    await press("Show selected month");
    expect(h.summary).toHaveBeenLastCalledWith({
      month: "2024-02",
      currency: "JPY"
    });
  });
  it("refreshes after writes, on focus, and refuses pending results after account/source changes", async () => {
    const h = source();
    const pending = deferred<DashboardSummary>();
    h.summary.mockReturnValueOnce(pending.promise);
    const props = {
      initialMonth: "2026-10",
      onAdd: jest.fn(),
      onOpenDetail: jest.fn()
    };
    const view = render(<Dashboard source={h.data} {...props} />);
    await act(async () => {
      h.change();
    });
    expect(await screen.findByLabelText("Income. USD 20.50")).toBeVisible();
    await act(async () => {
      pending.resolve(fixture("2026-10", 999, 0));
    });
    expect(screen.queryByLabelText("Income. USD 9.99")).toBeNull();
    view.rerender(<Dashboard source={h.data} active={false} {...props} />);
    expect(h.unsubscribe).toHaveBeenCalled();
    view.rerender(<Dashboard source={h.data} active {...props} />);
    await waitFor(() => expect(h.summary).toHaveBeenCalledTimes(3));
    const oldRead = deferred<DashboardSummary>();
    h.summary.mockReturnValueOnce(oldRead.promise);
    await press("Refresh summary");
    const other = source();
    other.summary.mockResolvedValue(fixture("2026-10", 0, 1));
    view.rerender(<Dashboard source={other.data} {...props} />);
    expect(
      await screen.findByLabelText("Net deficit. USD -0.01")
    ).toBeVisible();
    await act(async () => {
      oldRead.resolve(fixture());
    });
    expect(screen.queryByLabelText("Income. USD 20.50")).toBeNull();
    view.unmount();
    expect(other.unsubscribe).toHaveBeenCalled();
  });
  it("handles income-only activity and month navigation bounds", async () => {
    const h = source();
    h.summary.mockResolvedValue({
      ...fixture("0001-01", 100, 0),
      recentTransactions: []
    });
    render(
      <Dashboard
        source={h.data}
        initialMonth="0001-01"
        onAdd={jest.fn()}
        onOpenDetail={jest.fn()}
      />
    );
    expect(
      await screen.findByText("No expenses in this month and currency.")
    ).toBeVisible();
    expect(screen.queryByText("No transactions this month")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Previous month" })
    ).toBeDisabled();
    await press("Choose month");
    await act(async () => {
      fireEvent.changeText(screen.getByLabelText("Month (YYYY-MM)"), "9999-12");
    });
    await press("Show selected month");
    expect(screen.getByRole("button", { name: "Next month" })).toBeDisabled();
  });
});
