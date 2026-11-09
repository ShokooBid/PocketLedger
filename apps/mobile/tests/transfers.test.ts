import { expect, it, jest } from "@jest/globals";
import { createDemoFinanceSources } from "../src/account-data";
import { createDemoCategorySource } from "../src/category-data";
import { createDemoDashboardSource } from "../src/dashboard-data";
import {
  createApiTransferSource,
  transferCreate,
  type TransferCreate
} from "../src/transfer-data";
import { createTransport, type FetchRequest } from "../src/auth/transport";
import { response } from "./auth-fixtures";
import type { Currency } from "../src/transaction-data";

const key = "90000000-0000-4000-8000-000000000001";
async function setup() {
  const categories = createDemoCategorySource({ catalog: false });
  let currency: Currency = "CAD";
  const sources = createDemoFinanceSources(categories, () => currency);
  const account = {
    type: "bank" as const,
    currency,
    openingDate: "2026-01-01",
    openingBalanceMinor: 10000
  };
  const from = await sources.accounts.create({ ...account, name: "From" }),
    to = await sources.accounts.create({
      ...account,
      name: "To",
      openingBalanceMinor: 0
    });
  const input: TransferCreate = {
    fromAccountId: from.id,
    toAccountId: to.id,
    amountMinor: 2500,
    date: "2026-02-01",
    note: null,
    clientRequestId: key
  };
  return {
    ...sources,
    categories,
    from,
    to,
    input,
    setCurrency: (next: Currency) => {
      currency = next;
    }
  };
}
it("moves demo balances together without affecting ordinary history or spending", async () => {
  const { accounts, transactions, transfers, categories, from, to, input } =
    await setup();
  const categoryId = await categories.create("Food");
  await transactions.create({
    accountId: from.id,
    categoryId,
    amountMinor: 100,
    date: input.date,
    direction: "expense",
    note: null,
    clientRequestId: key
  });
  const dashboard = createDemoDashboardSource(transactions, categories),
    before = await dashboard.summary({ month: "2026-02", currency: "CAD" });
  const saved = await transfers.create(input);
  expect(saved.currency).toBe("CAD");
  expect(saved).not.toHaveProperty("categoryId");
  expect(saved).not.toHaveProperty("clientRequestId");
  expect((await accounts.get(from.id, input.date)).balanceMinor).toBe(7400);
  expect((await accounts.get(to.id, input.date)).balanceMinor).toBe(2500);
  expect((await accounts.get(to.id, "2026-01-31")).balanceMinor).toBe(0);
  expect((await transactions.list({})).items).toHaveLength(1);
  expect(
    await dashboard.summary({ month: "2026-02", currency: "CAD" })
  ).toEqual(before);
  await transfers.update(saved.id, {
    fromAccountId: to.id,
    toAccountId: from.id,
    amountMinor: 3000,
    date: "2026-02-02",
    note: "Updated"
  });
  expect((await accounts.get(from.id, "2026-02-02")).balanceMinor).toBe(12900);
  expect((await accounts.get(to.id, "2026-02-02")).balanceMinor).toBe(-3000);
  expect((await transfers.list({ accountId: from.id })).items).toHaveLength(1);
  expect(
    (await transfers.list({ from: input.date, to: input.date })).items
  ).toEqual([]);
  await transfers.remove(saved.id);
  expect((await accounts.get(from.id, "2026-02-02")).balanceMinor).toBe(9900);
  expect((await accounts.get(to.id, "2026-02-02")).balanceMinor).toBe(0);
});
it("replays original creation after edits and archive, conflicts on changed intent and releases keys on deletion", async () => {
  const { accounts, transfers, to, input } = await setup();
  const [first, second] = await Promise.all([
    transfers.create(input),
    transfers.create(input)
  ]);
  expect(first.id).toBe(second.id);
  const updated = await transfers.update(first.id, {
    amountMinor: 3000,
    note: "Edited"
  });
  expect(await transfers.create(input)).toEqual(updated);
  await expect(
    transfers.create({ ...input, amountMinor: 3000 })
  ).rejects.toMatchObject({ kind: "conflict", code: "IDEMPOTENCY_KEY_REUSED" });
  await transfers.remove(first.id);
  const recreated = await transfers.create(input);
  expect(recreated.id).not.toBe(first.id);
  await accounts.archive(to.id);
  expect(await transfers.create(input)).toEqual(recreated);
  await expect(
    transfers.update(recreated.id, { note: "Archived" })
  ).rejects.toMatchObject({ code: "INVALID_ACCOUNT" });
  await transfers.remove(recreated.id);
  await expect(transfers.create(input)).rejects.toMatchObject({
    code: "INVALID_ACCOUNT"
  });
});
it("validates owned, active, distinct, same-currency accounts and dates without changing balances", async () => {
  const sources = await setup(),
    { accounts, transfers, input, from } = sources;
  for (const [extra, code] of [
    [{ toAccountId: from.id }, "INVALID_TRANSFER"],
    [{ date: "2025-12-31" }, "INVALID_ACCOUNT"]
  ] as const)
    await expect(
      transfers.create({ ...input, ...extra })
    ).rejects.toMatchObject({ code });
  await expect(
    transfers.create({
      ...input,
      toAccountId: "70000000-0000-4000-8000-000000000001"
    })
  ).rejects.toMatchObject({ kind: "unavailable" });
  sources.setCurrency("USD");
  const usd = await accounts.create({
    name: "USD",
    type: "cash",
    currency: "USD",
    openingDate: "2026-01-01",
    openingBalanceMinor: 0
  });
  sources.setCurrency("CAD");
  await expect(
    transfers.create({ ...input, toAccountId: usd.id })
  ).rejects.toMatchObject({ code: "CURRENCY_MISMATCH" });
  expect((await accounts.get(from.id, input.date)).balanceMinor).toBe(10000);
  expect((await transfers.list()).items).toEqual([]);
  expect(
    transferCreate.safeParse({ ...input, categoryId: from.id }).success
  ).toBe(false);
});
it("serializes demo archival with transfer creates and edits", async () => {
  const { accounts, transfers, from, to, input } = await setup();
  const [creation] = await Promise.allSettled([
    transfers.create(input),
    accounts.archive(to.id)
  ]);
  const amount = creation.status === "fulfilled" ? 2500 : 0;
  expect((await accounts.get(from.id, input.date)).balanceMinor).toBe(
    10000 - amount
  );
  expect((await accounts.get(to.id, input.date)).balanceMinor).toBe(amount);
  const next = await setup(),
    saved = await next.transfers.create(next.input);
  const [edit] = await Promise.allSettled([
    next.transfers.update(saved.id, { amountMinor: 4000 }),
    next.accounts.archive(next.from.id)
  ]);
  const current = await next.transfers.get(saved.id);
  expect(current.amountMinor).toBe(edit.status === "fulfilled" ? 4000 : 2500);
  expect((await next.accounts.get(next.from.id, input.date)).balanceMinor).toBe(
    10000 - current.amountMinor
  );
  expect((await next.accounts.get(next.to.id, input.date)).balanceMinor).toBe(
    current.amountMinor
  );
  const archivedFirst = await setup();
  await archivedFirst.accounts.archive(archivedFirst.to.id);
  await expect(
    archivedFirst.transfers.create(archivedFirst.input)
  ).rejects.toMatchObject({ code: "INVALID_ACCOUNT" });
});
it("uses allowlisted API paths, validates responses, and leaves lost-response retry identity with the caller", async () => {
  const { input } = await setup(),
    { clientRequestId, ...fields } = input,
    saved = {
      ...fields,
      id: "30000000-0000-4000-8000-000000000001",
      currency: "CAD",
      createdAt: "2026-02-01T00:00:00Z",
      updatedAt: "2026-02-01T00:00:00Z"
    };
  const fetcher = jest
    .fn<FetchRequest>()
    .mockRejectedValueOnce(new Error("Synthetic lost response"))
    .mockResolvedValue(response(saved));
  const api = createApiTransferSource(
    createTransport("https://api.example.invalid", fetcher)
  );
  await expect(api.create(input)).rejects.toMatchObject({ kind: "network" });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0]?.[1].body).toContain(clientRequestId);
  await expect(api.create(input)).resolves.toMatchObject({ id: saved.id });
  expect(fetcher.mock.calls[0]?.[1].body).toBe(fetcher.mock.calls[1]?.[1].body);
  await expect(api.update(saved.id, { note: null })).resolves.toMatchObject({
    id: saved.id
  });
  expect(fetcher.mock.calls[2]?.[0]).toBe(
    `https://api.example.invalid/v1/transfers/${saved.id}`
  );
  fetcher.mockResolvedValueOnce(response({ items: [saved], nextCursor: null }));
  expect((await api.list({ accountId: input.toAccountId })).items).toHaveLength(
    1
  );
  expect(fetcher.mock.calls[3]?.[0]).toContain(
    `accountId=${input.toAccountId}`
  );
  expect(() => api.get("bad")).toThrow();
  fetcher.mockResolvedValueOnce(response({ ...saved, currency: "BAD" }));
  await expect(api.get(saved.id)).rejects.toMatchObject({ kind: "protocol" });
});
