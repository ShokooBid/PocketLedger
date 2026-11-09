import { describe, expect, it, vi } from "vitest";
import {
  transferCreate,
  transferPatch,
  transferQuery
} from "../src/transfers/contracts.js";
import {
  createTransferService,
  transferCreationFingerprint
} from "../src/transfers/service.js";
import type { PrismaClient } from "../src/generated/prisma/client.js";

const input = {
  fromAccountId: "20000000-0000-4000-8000-00000000000a",
  toAccountId: "20000000-0000-4000-8000-00000000000b",
  amountMinor: 2500,
  date: "2026-02-01",
  note: null,
  clientRequestId: "10000000-0000-4000-8000-000000000001"
};
describe("transfer contract and creation intent", () => {
  it("accepts account IDs, exact money, date and optional description only", () => {
    expect(transferCreate.parse({ ...input, note: undefined }).note).toBeNull();
    for (const extra of [
      { categoryId: input.fromAccountId },
      { currency: "CAD" },
      { userId: input.fromAccountId },
      { transferId: input.fromAccountId },
      { creationFingerprint: "a".repeat(64) },
      { postings: [] },
      { amountMinor: 0 },
      { amountMinor: -1 },
      { amountMinor: 1.5 },
      { amountMinor: 2147483648 },
      { amountMinor: "2500" },
      { date: "2026-02-29" },
      { date: "0000-01-01" },
      { note: "a\u200bb" },
      { fromAccountId: "bad" },
      { clientRequestId: undefined }
    ])
      expect(
        transferCreate.safeParse({ ...input, ...extra }).success,
        JSON.stringify(extra)
      ).toBe(false);
    for (const patch of [
      {},
      { clientRequestId: input.clientRequestId },
      { currency: "USD" },
      { categoryId: null }
    ])
      expect(transferPatch.safeParse(patch).success).toBe(false);
    expect(transferPatch.parse({ amountMinor: 100 })).toEqual({
      amountMinor: 100
    });
    expect(transferPatch.parse({ note: null })).toEqual({ note: null });
    for (const query of [
      { from: "2026-01-01" },
      { from: "2026-02-01", to: "2026-01-01" },
      { limit: 101 },
      { accountId: "bad" }
    ])
      expect(transferQuery.safeParse(query).success).toBe(false);
  });
  it("hashes canonical original intent independently of UUID case and empty description", () => {
    const hash = transferCreationFingerprint(input);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(
      transferCreationFingerprint({
        ...input,
        fromAccountId: input.fromAccountId.toUpperCase(),
        note: ""
      })
    ).toBe(hash);
    for (const change of [
      { toAccountId: input.fromAccountId },
      { amountMinor: 2501 },
      { date: "2026-02-02" },
      { note: "Edited" }
    ])
      expect(transferCreationFingerprint({ ...input, ...change })).not.toBe(
        hash
      );
  });
  it("rejects mismatched account currencies before writing an aggregate", async () => {
    const create = vi.fn();
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: "owner" }]),
      transfer: { findUnique: vi.fn().mockResolvedValue(null), create },
      account: {
        findMany: vi.fn().mockResolvedValue([
          {
            currency: "CAD",
            openingDate: new Date("2026-01-01"),
            archivedAt: null
          },
          {
            currency: "USD",
            openingDate: new Date("2026-01-01"),
            archivedAt: null
          }
        ])
      }
    };
    const db = {
      $transaction: (action: (value: typeof tx) => unknown) => action(tx)
    } as unknown as PrismaClient;
    await expect(
      createTransferService(db).create("owner", input)
    ).rejects.toMatchObject({ code: "CURRENCY_MISMATCH" });
    expect(create).not.toHaveBeenCalled();
  });
});
