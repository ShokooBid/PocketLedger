import { describe, expect, it, vi } from "vitest";
import { historyQuery } from "../src/history/contracts.js";
import {
  createHistoryService,
  historyKey,
  revealFilters
} from "../src/history/service.js";
import type { PrismaClient } from "../src/generated/prisma/client.js";
import type { HistoryRow } from "../src/history/contracts.js";

const id = "30000000-0000-4000-8000-000000000001";
const row: HistoryRow = {
  id,
  kind: "transaction",
  type: "expense",
  date: "2026-10-29",
  amountMinor: 1250,
  currency: "CAD",
  note: null,
  accountId: "10000000-0000-4000-8000-000000000001",
  accountName: "Cash",
  toAccountId: null,
  toAccountName: null,
  categoryId: "20000000-0000-4000-8000-000000000002",
  categoryName: "Groceries",
  parentCategoryId: "20000000-0000-4000-8000-000000000001",
  parentCategoryName: "Food",
  iconKey: "category"
};
describe("History read/reveal contracts", () => {
  it("rejects unsafe full-day totals even when income and expense cancel to zero", async () => {
    const amount = BigInt(Number.MAX_SAFE_INTEGER) + 1n;
    const tx = {
      $queryRaw: vi
        .fn()
        .mockResolvedValueOnce([row])
        .mockResolvedValueOnce([
          {
            date: row.date,
            currency: "CAD",
            count: 2n,
            incomeMinor: amount,
            expensesMinor: amount
          }
        ])
        .mockResolvedValueOnce([{ older: false, newer: false }])
    };
    const db = {
      $transaction: (action: (value: typeof tx) => Promise<unknown>) =>
        action(tx)
    };
    await expect(
      createHistoryService(db as unknown as PrismaClient).list(
        id,
        historyQuery.parse({})
      )
    ).rejects.toMatchObject({
      status: 422,
      code: "SUMMARY_AMOUNT_OUT_OF_RANGE"
    });
  });
  it("requires paired inclusive bounded dates, category scope and one pagination position", () => {
    for (const input of [
      { from: "2026-10-01" },
      { from: "2026-02-30", to: "2026-03-01" },
      { from: "2026-10-30", to: "2026-10-01" },
      { from: "2024-01-01", to: "2025-01-02" },
      { includeSubcategories: "true" },
      { focusId: id },
      { focusKind: "transaction" },
      { after: historyKey(row), before: historyKey(row) },
      { focusId: id, focusKind: "transaction", after: historyKey(row) },
      { userId: id },
      { limit: 101 }
    ])
      expect(historyQuery.safeParse(input).success).toBe(false);
    expect(
      historyQuery.parse({
        from: row.date,
        to: row.date,
        includeSubcategories: "true",
        categoryId: row.parentCategoryId
      })
    ).toMatchObject({ limit: 50, includeSubcategories: true });
  });
  it("keeps matching subtree/account/type filters and adjusts only an excluding date boundary", () => {
    expect(
      revealFilters(
        {
          from: "2026-11-01",
          to: "2026-11-30",
          accountId: row.accountId,
          type: "expense",
          categoryId: row.parentCategoryId!,
          includeSubcategories: true
        },
        row
      )
    ).toEqual({
      applied: {
        from: row.date,
        to: "2026-11-30",
        accountId: row.accountId,
        type: "expense",
        categoryId: row.parentCategoryId,
        includeSubcategories: true
      },
      adjustments: ["Date range adjusted to include the saved record."]
    });
  });
  it("clears excluding filters without changing the saved resource or expanding beyond 366 days", () => {
    const original = { ...row };
    const result = revealFilters(
      {
        from: "2020-01-01",
        to: "2020-01-31",
        accountId: id,
        type: "income",
        categoryId: row.parentCategoryId!,
        currency: "USD"
      },
      row
    );
    expect(result.applied).toEqual({ from: row.date, to: row.date });
    expect(result.adjustments).toHaveLength(5);
    expect(row).toEqual(original);
  });
  it("retains a transfer's destination account and distinguishes same-UUID resource kinds", () => {
    const transfer: HistoryRow = {
      ...row,
      kind: "transfer",
      type: "transfer",
      categoryId: null,
      parentCategoryId: null,
      toAccountId: id,
      toAccountName: "Savings"
    };
    expect(
      revealFilters({ accountId: id, type: "transfer" }, transfer).adjustments
    ).toEqual([]);
    expect(historyKey(row)).not.toBe(historyKey(transfer));
  });
});
