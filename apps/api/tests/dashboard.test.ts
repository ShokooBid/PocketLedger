import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../src/generated/prisma/client.js";
import { summaryQuery, summarySchema } from "../src/dashboard/contracts.js";
import { createDashboardService } from "../src/dashboard/service.js";

const query = {
  from: "2026-10-01",
  to: "2026-10-31",
  currency: "USD",
  recentLimit: 5
} as const;
function service(groups: { incomeMinor: bigint; expensesMinor: bigint }[]) {
  // Only the database boundary is replaced: exercise real total/overflow logic.
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue(
      groups.map((group, index) => ({
        categoryId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        categoryName: "Synthetic category",
        ...group
      }))
    ),
    transaction: { findMany: vi.fn().mockResolvedValue([]) }
  };
  const db = {
    $transaction: async (run: (client: typeof tx) => Promise<unknown>) =>
      run(tx)
  };
  return createDashboardService(db as unknown as PrismaClient);
}
describe("dashboard exact monetary boundary", () => {
  it("accepts the largest safe JSON integer and a negative net", async () => {
    const result = await service([
      { incomeMinor: 0n, expensesMinor: BigInt(Number.MAX_SAFE_INTEGER) }
    ]).summary("owner", query);
    expect(result).toMatchObject({
      incomeMinor: 0,
      expensesMinor: Number.MAX_SAFE_INTEGER,
      netMinor: -Number.MAX_SAFE_INTEGER
    });
    expect(summarySchema.safeParse(result).success).toBe(true);
  });
  it("rejects an unsafe category sum even when the net would cancel", async () => {
    const amount = BigInt(Number.MAX_SAFE_INTEGER) + 1n;
    await expect(
      service([{ incomeMinor: amount, expensesMinor: amount }]).summary(
        "owner",
        query
      )
    ).rejects.toMatchObject({
      status: 422,
      code: "SUMMARY_AMOUNT_OUT_OF_RANGE"
    });
  });
  it("rejects unsafe overall totals made from individually safe categories", async () => {
    await expect(
      service([
        { incomeMinor: BigInt(Number.MAX_SAFE_INTEGER), expensesMinor: 0n },
        { incomeMinor: 1n, expensesMinor: 0n }
      ]).summary("owner", query)
    ).rejects.toMatchObject({ code: "SUMMARY_AMOUNT_OUT_OF_RANGE" });
  });
  it("defines inclusive dates at most 366 days apart without local-time arithmetic", () => {
    expect(
      summaryQuery.parse({
        from: "2024-01-01",
        to: "2025-01-01",
        currency: "USD"
      }).recentLimit
    ).toBe(5);
    expect(
      summaryQuery.safeParse({ ...query, from: "2024-01-01", to: "2025-01-02" })
        .success
    ).toBe(false);
    for (const date of ["0001-01-01", "9999-12-31", "2024-02-29"])
      expect(
        summaryQuery.safeParse({ ...query, from: date, to: date }).success
      ).toBe(true);
  });
});
