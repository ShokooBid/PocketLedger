import { expect, it, jest } from "@jest/globals";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import { createDemoFinanceSources } from "../src/account-data";
import { createDemoCategorySource } from "../src/category-data";
import { ClientFailure } from "../src/auth/transport";
import { useTransferManagement } from "../src/use-transfer-management";
import type { Transfer, TransferChange } from "../src/transfer-data";
import { deferred } from "./auth-fixtures";

async function setup() {
  const sources = createDemoFinanceSources(
    createDemoCategorySource({ catalog: false }),
    () => "CAD"
  );
  const fields = {
    type: "cash" as const,
    currency: "CAD" as const,
    openingDate: "2024-01-01",
    openingBalanceMinor: 0
  };
  const from = await sources.accounts.create({
      ...fields,
      name: "From",
      openingBalanceMinor: 10000
    }),
    to = await sources.accounts.create({ ...fields, name: "To" });
  const row = await sources.transfers.create({
    fromAccountId: from.id,
    toAccountId: to.id,
    amountMinor: 2500,
    date: "2026-02-01",
    note: "Savings",
    clientRequestId: "90000000-0000-4000-8000-000000000001"
  });
  return { ...sources, from, to, row };
}
it("refreshes both detail balances after a whole-transfer edit and prevents double deletion", async () => {
  const { accounts, transfers, row, from, to } = await setup();
  const hook = renderHook(() =>
    useTransferManagement({
      source: transfers,
      accounts,
      detailId: row.id,
      onEdit: () => {}
    })
  );
  await waitFor(() =>
    expect(hook.result.current.balances).toMatchObject({
      [from.id]: { balanceMinor: 7500 },
      [to.id]: { balanceMinor: 2500 }
    })
  );
  await act(async () => {
    await transfers.update(row.id, { amountMinor: 3000 });
  });
  await waitFor(() =>
    expect(hook.result.current.balances).toMatchObject({
      [from.id]: { balanceMinor: 7000 },
      [to.id]: { balanceMinor: 3000 }
    })
  );
  const gate = deferred<void>(),
    realRemove = transfers.remove;
  const remove = jest
    .spyOn(transfers, "remove")
    .mockImplementation(async (id) => {
      await gate.promise;
      await realRemove(id);
    });
  act(() => hook.result.current.askDelete(hook.result.current.rows[0]!));
  let deleting!: Promise<void>;
  act(() => {
    deleting = hook.result.current.remove();
    void hook.result.current.remove();
  });
  expect(remove).toHaveBeenCalledTimes(1);
  await act(async () => {
    gate.resolve(undefined);
    await deleting;
  });
  await waitFor(() => expect(hook.result.current.rows).toEqual([]));
  expect((await accounts.get(from.id, row.date)).balanceMinor).toBe(10000);
  expect((await accounts.get(to.id, row.date)).balanceMinor).toBe(0);
});
it("reconciles a lost delete response through an explicit read without another delete", async () => {
  const { accounts, transfers, row } = await setup(),
    reconciled = jest.fn();
  const realRemove = transfers.remove;
  const remove = jest
    .spyOn(transfers, "remove")
    .mockImplementation(async (id) => {
      await realRemove(id);
      throw new ClientFailure("network");
    });
  const hook = renderHook(() =>
    useTransferManagement({
      source: transfers,
      accounts,
      detailId: row.id,
      onEdit: () => {},
      onReconciled: reconciled
    })
  );
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  act(() => hook.result.current.askDelete(row));
  await act(async () => {
    await hook.result.current.remove();
  });
  expect(hook.result.current.uncertain).toBe(true);
  act(() => hook.result.current.cancelDelete());
  expect(hook.result.current.deleting?.id).toBe(row.id);
  await act(async () => {
    await hook.result.current.reviewDelete();
  });
  expect(hook.result.current.uncertain).toBe(false);
  expect(hook.result.current.deleting).toBeNull();
  expect(remove).toHaveBeenCalledTimes(1);
  expect(reconciled).toHaveBeenCalledTimes(1);
});
it("ignores an older detail read that finishes after an edit notification", async () => {
  const { accounts, transfers, row } = await setup(),
    stale = deferred<Transfer>(),
    realGet = transfers.get;
  jest
    .spyOn(transfers, "get")
    .mockImplementationOnce(() => stale.promise)
    .mockImplementation(realGet);
  const hook = renderHook(() =>
    useTransferManagement({
      source: transfers,
      accounts,
      detailId: row.id,
      onEdit: () => {}
    })
  );
  await act(async () => {
    await transfers.update(row.id, { amountMinor: 3000 });
  });
  await waitFor(() =>
    expect(hook.result.current.rows[0]?.amountMinor).toBe(3000)
  );
  await act(async () => {
    stale.resolve(row);
  });
  expect(hook.result.current.rows[0]?.amountMinor).toBe(3000);
});
it("retains loaded rows when a cursor does not advance", async () => {
  const { accounts, transfers, row } = await setup();
  const list = jest
    .spyOn(transfers, "list")
    .mockResolvedValue({ items: [row], nextCursor: `${row.date}_${row.id}` });
  const hook = renderHook(() =>
    useTransferManagement({ source: transfers, accounts, onEdit: () => {} })
  );
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  await act(async () => {
    await hook.result.current.load(true);
  });
  expect(hook.result.current.rows).toEqual([row]);
  expect(hook.result.current.error).not.toBeNull();
  expect(list).toHaveBeenCalledTimes(2);
});
it("publishes confirmed aggregate changes even when another listener throws", async () => {
  const { transfers, row } = await setup(),
    listener = jest.fn<(change: TransferChange) => void>();
  const stopFailing = transfers.subscribe(() => {
    throw new Error("Synthetic UI observer failure");
  });
  const stop = transfers.subscribe(listener);
  await transfers.update(row.id, { note: "Edited" });
  expect(listener).toHaveBeenCalledWith({
    type: "saved",
    row: expect.objectContaining({ id: row.id, note: "Edited" })
  });
  await transfers.remove(row.id);
  expect(listener).toHaveBeenCalledWith({ type: "deleted", id: row.id });
  stop();
  stopFailing();
});
