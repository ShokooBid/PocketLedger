import { describe, expect, it, jest } from "@jest/globals";
import {
  adjacentMonth,
  currentMonth,
  monthRange,
  moneyLabel,
  createApiDashboardSource,
  createDemoDashboardSource,
  dashboardSchema
} from "../src/dashboard-data";
import { createTransport, type FetchRequest } from "../src/auth/transport";
import { createDemoCategorySource } from "../src/category-data";
import { createDemoTransactionSource } from "../src/transaction-data";
import { response } from "./auth-fixtures";

const empty = {
  from: "2026-10-01",
  to: "2026-10-31",
  currency: "USD",
  incomeMinor: 0,
  expensesMinor: 0,
  netMinor: 0,
  categoryBreakdown: [],
  recentTransactions: []
};
describe("dashboard calendar and money rules", () => {
  it("handles leap years, year transitions and supported bounds without local-time conversion", () => {
    expect(monthRange("2024-02")).toEqual({
      from: "2024-02-01",
      to: "2024-02-29"
    });
    expect(monthRange("1900-02").to).toBe("1900-02-28");
    expect(monthRange("2000-02").to).toBe("2000-02-29");
    expect(monthRange("0001-02").to).toBe("0001-02-28");
    expect(monthRange("9999-12").to).toBe("9999-12-31");
    expect(monthRange("2026-04").to).toBe("2026-04-30");
    expect(adjacentMonth("2026-01", -1)).toBe("2025-12");
    expect(adjacentMonth("2026-12", 1)).toBe("2027-01");
    expect(adjacentMonth("0001-01", -1)).toBeNull();
    expect(adjacentMonth("9999-12", 1)).toBeNull();
    expect(currentMonth(new Date(2026, 0, 1))).toBe("2026-01");
    for (const month of [
      "0000-01",
      "2026-00",
      "2026-13",
      "26-01",
      "2026-1",
      "2026-01-01",
      "2026-01T00:00:00Z",
      "2026-01\n"
    ])
      expect(() => monthRange(month)).toThrow();
  });
  it("formats signed totals exactly for each minor-unit exponent", () => {
    expect(moneyLabel(-1, "USD")).toBe("USD -0.01");
    expect(moneyLabel(0, "EUR")).toBe("EUR 0.00");
    expect(moneyLabel(1234, "KWD")).toBe("KWD 1.234");
    expect(moneyLabel(-1234, "JPY")).toBe("JPY -1234");
    expect(moneyLabel(Number.MAX_SAFE_INTEGER, "USD")).toBe(
      "USD 90071992547409.91"
    );
  });
});
describe("dashboard data boundaries", () => {
  it("uses the summary endpoint and refuses malformed or mismatched responses", async () => {
    const fetcher = jest.fn<FetchRequest>().mockResolvedValue(response(empty));
    const changes = { subscribe: jest.fn(() => () => {}) };
    const source = createApiDashboardSource(
      createTransport("https://api.example.invalid", fetcher),
      changes
    );
    expect(await source.summary({ month: "2026-10", currency: "USD" })).toEqual(
      empty
    );
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "https://api.example.invalid/v1/dashboard/summary?from=2026-10-01&to=2026-10-31&currency=USD&recentLimit=5"
    );
    for (const invalid of [
      { ...empty, from: "2026-09-01" },
      { ...empty, currency: "EUR" },
      { ...empty, expensesMinor: -1 },
      { ...empty, incomeMinor: 1.5 },
      { ...empty, incomeMinor: Number.MAX_SAFE_INTEGER + 1 },
      { ...empty, netMinor: 1 },
      { ...empty, incomeMinor: 1, netMinor: 1 }
    ]) {
      fetcher.mockResolvedValueOnce(response(invalid));
      await expect(
        source.summary({ month: "2026-10", currency: "USD" })
      ).rejects.toMatchObject({ kind: "protocol" });
    }
    expect(dashboardSchema.safeParse(empty).success).toBe(true);
  });
  it("keeps demo totals complete across pages, separates currencies, and retains archived names", async () => {
    const categories = createDemoCategorySource();
    await categories.create("Food");
    const transactions = createDemoTransactionSource(categories);
    const source = createDemoDashboardSource(transactions, categories);
    const listener = jest.fn();
    const unsubscribe = source.subscribe(listener);
    const input = {
      direction: "expense" as const,
      amountMinor: 101,
      currency: "USD" as const,
      date: "2026-10-01",
      categoryId: "demo-1",
      merchant: "Synthetic shop",
      note: null
    };
    for (let n = 0; n < 51; n++) await transactions.create(input);
    await transactions.create({ ...input, currency: "JPY", amountMinor: 999 });
    await transactions.create({
      ...input,
      direction: "income",
      amountMinor: 10000
    });
    await transactions.create({ ...input, date: "2026-11-01" });
    await categories.archive("demo-1");
    const summary = await source.summary({ month: "2026-10", currency: "USD" });
    expect(summary).toMatchObject({
      incomeMinor: 10000,
      expensesMinor: 5151,
      netMinor: 4849,
      categoryBreakdown: [{ categoryName: "Food", expensesMinor: 5151 }]
    });
    expect(summary.recentTransactions).toHaveLength(5);
    expect(
      summary.recentTransactions.every((row) => row.currency === "USD")
    ).toBe(true);
    expect(listener).toHaveBeenCalledTimes(54);
    unsubscribe();
    await transactions.remove(summary.recentTransactions[0]!.id);
    expect(listener).toHaveBeenCalledTimes(54);
    expect(
      await source.summary({ month: "2026-09", currency: "USD" })
    ).toMatchObject({
      incomeMinor: 0,
      expensesMinor: 0,
      netMinor: 0,
      categoryBreakdown: [],
      recentTransactions: []
    });
  });
});
