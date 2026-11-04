import { describe, expect, it, vi } from "vitest";
import {
  transactionCreate,
  transactionPatch,
  transactionQuery
} from "../src/transactions/contracts.js";
import { createAccountService } from "../src/accounts/service.js";
import type { PrismaClient } from "../src/generated/prisma/client.js";

const input = {
  clientRequestId: "10000000-0000-4000-8000-000000000001",
  accountId: "20000000-0000-4000-8000-000000000001",
  categoryId: "30000000-0000-4000-8000-000000000001",
  direction: "expense",
  amountMinor: 1250,
  currency: "CAD",
  date: "2026-11-03"
};
describe("versioned normal-transaction contracts", () => {
  it("requires accounts and rejects merchant fields", () => {
    expect(transactionCreate.parse(input).note).toBeNull();
    for (const extra of [
      { merchant: "Shop" },
      { payee: "Shop" },
      { userId: input.accountId },
      { importId: input.accountId },
      { amountMinor: "1250" },
      { amountMinor: 0 },
      { amountMinor: -1 },
      { amountMinor: 1.2 },
      { amountMinor: 2147483648 },
      { date: "2026-02-29" },
      { date: "0000-01-01" },
      { note: "a\u200bb" },
      { accountId: "bad" }
    ])
      expect(
        transactionCreate.safeParse({ ...input, ...extra }).success,
        JSON.stringify(extra)
      ).toBe(false);
    const withoutAccount = { ...input, accountId: undefined };
    const withoutKey = { ...input, clientRequestId: undefined };
    expect(transactionCreate.safeParse(withoutAccount).success).toBe(false);
    expect(transactionCreate.safeParse(withoutKey).success).toBe(false);
    for (const patch of [
      {},
      { clientRequestId: input.clientRequestId },
      { importId: null },
      { merchant: "Shop" }
    ])
      expect(transactionPatch.safeParse(patch).success).toBe(false);
    expect(transactionPatch.parse({ note: null })).toEqual({
      note: null
    });
    for (const date of ["0001-01-01", "2024-02-29", "9999-12-31"])
      expect(transactionCreate.safeParse({ ...input, date }).success).toBe(
        true
      );
  });
  it("bounds transaction filters", () => {
    for (const query of [
      { limit: 101 },
      { from: "2026-01-01" },
      { includeSubcategories: "true" },
      { accountId: "bad" }
    ])
      expect(transactionQuery.safeParse(query).success).toBe(false);
  });
});

describe("account balance JSON integer boundary", () => {
  function service(postings: bigint) {
    const tx = {
      account: {
        findFirst: vi.fn().mockResolvedValue({
          id: input.accountId,
          name: "Cash",
          type: "cash",
          currency: "CAD",
          openingBalanceMinor: 1,
          openingDate: new Date("2026-01-01"),
          archivedAt: null,
          createdAt: new Date("2026-01-01"),
          updatedAt: new Date("2026-01-01")
        })
      },
      $queryRaw: vi.fn().mockResolvedValue([{ postings }])
    };
    return createAccountService({
      $transaction: (run: (tx: unknown) => unknown) => run(tx)
    } as unknown as PrismaClient);
  }
  it("checks the final exact sum before converting it to a JSON number", async () => {
    expect(
      (
        await service(BigInt(Number.MAX_SAFE_INTEGER) - 1n).get(
          "owner",
          input.accountId
        )
      ).balanceMinor
    ).toBe(Number.MAX_SAFE_INTEGER);
    await expect(
      service(BigInt(Number.MAX_SAFE_INTEGER)).get("owner", input.accountId)
    ).rejects.toMatchObject({
      status: 422,
      code: "SUMMARY_AMOUNT_OUT_OF_RANGE"
    });
    await expect(
      service(BigInt(Number.MIN_SAFE_INTEGER) - 2n).get(
        "owner",
        input.accountId
      )
    ).rejects.toMatchObject({ status: 422 });
  });
});
