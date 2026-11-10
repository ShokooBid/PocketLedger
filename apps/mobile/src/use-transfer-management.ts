import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import type { Account, AccountSource } from "./account-data";
import { ClientFailure } from "./auth/transport";
import { uncertainWrite } from "./transaction-data";
import {
  transferFailureMessage,
  type Transfer,
  type TransferSource
} from "./transfer-data";

export type TransferManagementProps = {
  source: TransferSource;
  accounts: AccountSource;
  active?: boolean;
  detailId?: string;
  onOpenDetail?: (id: string) => void;
  onEdit: (row: Transfer) => void;
  onReconciled?: () => void;
  writeBlocked?: boolean;
};

// Listing/detail reads and delete recovery live here. Editing uses the shared
// session entry draft, so opening Settings never loses transfer form values.
export function useTransferManagement({
  source,
  accounts,
  active = true,
  detailId,
  onReconciled,
  writeBlocked = false
}: TransferManagementProps) {
  const [rows, setRows] = useState<Transfer[]>([]),
    [choices, setChoices] = useState<Account[]>([]);
  const [balances, setBalances] = useState<
    Record<string, { balanceMinor: number; asOf: string }>
  >({});
  const [balanceError, setBalanceError] = useState(false);
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null),
    [notice, setNotice] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Transfer | null>(null),
    [uncertain, setUncertain] = useState(false),
    [reviewed, setReviewed] = useState(false);
  const [refreshRequested, setRefreshRequested] = useState(true),
    [after, setAfter] = useState<string | null>(null);
  const live = useRef(false),
    lock = useRef(false),
    version = useRef(0),
    cursor = useRef(after);
  cursor.current = after;
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      version.current++;
    };
  }, []);
  const load = useCallback(
    async (more = false) => {
      if (lock.current) return;
      const request = ++version.current,
        boundary = more ? cursor.current : null;
      setLoading(true);
      setError(null);
      try {
        const [page, nextAccounts] = await Promise.all([
          detailId
            ? source
                .get(detailId)
                .then((row) => ({ items: [row], nextCursor: null }))
                .catch((failure: unknown) => {
                  if (
                    failure instanceof ClientFailure &&
                    failure.kind === "unavailable"
                  )
                    return { items: [], nextCursor: null };
                  throw failure;
                })
            : source.list({}, boundary ?? undefined),
          accounts.list()
        ]);
        if (!live.current || request !== version.current) return;
        let previous = boundary;
        const keys = new Set<string>();
        for (const row of page.items) {
          const key = `${row.date}_${row.id}`;
          if ((previous && key >= previous) || keys.has(row.id))
            throw new ClientFailure("protocol");
          previous = key;
          keys.add(row.id);
        }
        if (
          page.nextCursor &&
          (!page.items.length || page.nextCursor !== previous)
        )
          throw new ClientFailure("protocol");
        setRows((current) =>
          more
            ? [...current.filter((row) => !keys.has(row.id)), ...page.items]
            : page.items
        );
        setChoices(nextAccounts);
        setAfter(page.nextCursor);
        setReady(true);
        if (detailId && page.items[0]) {
          const row = page.items[0],
            ids = [row.fromAccountId, row.toAccountId];
          setBalances({});
          setBalanceError(false);
          const details = await Promise.allSettled(
            ids.map((id) => {
              const account = nextAccounts.find((item) => item.id === id);
              const asOf = [
                new Date().toISOString().slice(0, 10),
                account?.openingDate ?? row.date
              ]
                .sort()
                .at(-1)!;
              return accounts.get(id, asOf);
            })
          );
          if (!live.current || request !== version.current) return;
          const next: Record<string, { balanceMinor: number; asOf: string }> =
            {};
          for (const result of details)
            if (result.status === "fulfilled")
              next[result.value.id] = {
                balanceMinor: result.value.balanceMinor,
                asOf: result.value.asOf
              };
          setBalances(next);
          setBalanceError(
            details.some((result) => result.status === "rejected")
          );
        }
      } catch {
        if (live.current && request === version.current) {
          setError(
            more
              ? "More transfers could not be loaded. Your current rows are kept; retry Load more transfers."
              : "Transfers or accounts could not be loaded. Your existing values are kept; reload transfers."
          );
          if (!more) setReady(false);
        }
      } finally {
        if (live.current && request === version.current) setLoading(false);
      }
    },
    [source, accounts, detailId]
  );
  useEffect(
    () =>
      source.subscribe(() => {
        version.current++;
        setLoading(false);
        setRefreshRequested(true);
      }),
    [source]
  );
  useEffect(() => {
    if (active) setRefreshRequested(true);
  }, [active, load]);
  useEffect(() => {
    if (active && refreshRequested && !busy && !loading) {
      setRefreshRequested(false);
      void load();
    }
  }, [active, refreshRequested, busy, loading, load]);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") setRefreshRequested(true);
    });
    return () => subscription.remove();
  }, []);
  function deleted(row: Transfer) {
    if (!live.current) return;
    setRows((current) => current.filter((item) => item.id !== row.id));
    setDeleting(null);
    setUncertain(false);
    setReviewed(false);
    setNotice("Transfer deleted. Both account balances updated.");
    setRefreshRequested(true);
  }
  async function remove() {
    if (lock.current || writeBlocked || !deleting || (uncertain && !reviewed))
      return;
    lock.current = true;
    version.current++;
    setLoading(false);
    setBusy(true);
    setError(null);
    setNotice(null);
    const row = deleting;
    try {
      await source.remove(row.id);
      deleted(row);
    } catch (failure) {
      if (!live.current) return;
      if (failure instanceof ClientFailure && failure.kind === "unavailable") {
        deleted(row);
        onReconciled?.();
      } else {
        setUncertain(uncertainWrite(failure));
        setReviewed(false);
        setError(transferFailureMessage(failure));
      }
    } finally {
      lock.current = false;
      if (live.current) setBusy(false);
    }
  }
  async function reviewDelete() {
    if (lock.current || !deleting) return;
    lock.current = true;
    setBusy(true);
    try {
      await source.get(deleting.id);
      if (live.current) {
        setReviewed(true);
        setNotice(
          "The transfer still exists. Confirm deletion again to retry the same transfer."
        );
      }
    } catch (failure) {
      if (failure instanceof ClientFailure && failure.kind === "unavailable") {
        deleted(deleting);
        onReconciled?.();
      } else if (live.current)
        setError(
          "Could not check the transfer. Keep this confirmation and retry the check."
        );
    } finally {
      lock.current = false;
      if (live.current) setBusy(false);
    }
  }
  return {
    rows,
    choices,
    balances,
    balanceError,
    busy,
    loading,
    ready,
    error,
    notice,
    deleting,
    uncertain,
    reviewed,
    after,
    load,
    remove,
    reviewDelete,
    askDelete(row: Transfer) {
      if (!lock.current && !uncertain) {
        setDeleting(row);
        setError(null);
        setNotice(null);
      }
    },
    cancelDelete() {
      if (!lock.current && !uncertain) setDeleting(null);
    },
    accountName(id: string) {
      const row = choices.find((item) => item.id === id);
      return row
        ? `${row.name}${row.archivedAt ? " (archived)" : ""}`
        : "Account unavailable";
    }
  };
}
