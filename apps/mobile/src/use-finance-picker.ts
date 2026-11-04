import { useCallback, useEffect, useRef, useState } from "react";
import type { Account, AccountSource } from "./account-data";
import {
  CategoryFailure,
  categoryFailureMessage,
  type Category,
  type CategorySource
} from "./category-data";
import { orderedCategories, selectableCategory } from "./category-hierarchy";
import type { Currency } from "./transaction-data";
import { ClientFailure } from "./auth/transport";

// Each modal owns one serialized request lifecycle. Closing it invalidates every
// pending callback, including a create whose response arrives after cancellation.
function usePickerTask(message: (error: unknown) => string) {
  const live = useRef(false);
  const revision = useRef(0);
  const locked = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      revision.current++;
      locked.current = false;
    };
  }, []);
  const run = useCallback(
    async (task: (current: () => boolean) => Promise<void>) => {
      if (locked.current || !live.current) return;
      locked.current = true;
      const version = ++revision.current;
      const current = () => live.current && revision.current === version;
      setBusy(true);
      setError(null);
      try {
        await task(current);
      } catch (failure) {
        if (current()) setError(message(failure));
      } finally {
        if (current()) {
          locked.current = false;
          setBusy(false);
        }
      }
    },
    [message]
  );
  return { busy, error, run };
}

export function useCategoryPicker(
  source: CategorySource,
  onSelect: (id: string, rows: Category[]) => void
) {
  const task = usePickerTask(categoryFailureMessage);
  const [rows, setRows] = useState<Category[] | null>(null);
  const [recent, setRecent] = useState<Category[]>([]);
  const [recentError, setRecentError] = useState(false);
  const [query, setQuery] = useState("");
  const [rootId, setRootId] = useState<string | null>(null);
  const [editor, setEditor] = useState<{
    name: string;
    parentId?: string;
  } | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [needsReload, setNeedsReload] = useState(false);
  const reload = useCallback(
    () =>
      task.run(async (current) => {
        const [all, used] = await Promise.allSettled([
          source.list(),
          source.recent()
        ]);
        if (!current()) return;
        if (all.status === "rejected") throw all.reason;
        setRows(all.value);
        setRecent(used.status === "fulfilled" ? used.value : []);
        setRecentError(used.status === "rejected");
        setNeedsReload(false);
      }),
    [source, task.run]
  );
  useEffect(() => {
    void reload();
  }, [reload]);
  const active = orderedCategories(rows ?? []).filter((row) =>
    selectableCategory(row, rows ?? [])
  );
  const root = active.find((row) => row.id === rootId);
  const search = query.trim().toLocaleLowerCase();
  const matches = active.filter((row) =>
    row.name.toLocaleLowerCase().includes(search)
  );
  const recentRows = recent.flatMap((used) => {
    const row = active.find((row) => row.id === used.id);
    return row ? [row] : [];
  });
  function select(id: string) {
    return task.run(async (current) => {
      const fresh = await source.list();
      if (!current()) return;
      setRows(fresh);
      const row = fresh.find((row) => row.id === id);
      if (!row || !selectableCategory(row, fresh))
        throw new CategoryFailure("unavailable");
      onSelect(row.id, fresh);
    });
  }
  function create() {
    if (!editor || needsReload || createdId) return;
    const input = editor;
    return task.run(async (current) => {
      let id: string;
      try {
        if (input.parentId) {
          if (!source.createChild) throw new CategoryFailure("invalid-parent");
          id = await source.createChild(input.name, input.parentId);
        } else id = await source.create(input.name);
      } catch (error) {
        if (
          current() &&
          error instanceof CategoryFailure &&
          error.code === "uncertain"
        ) {
          setEditor(null);
          setNeedsReload(true);
        }
        throw error;
      }
      if (!current()) return;
      // Retain the confirmed ID if refreshing fails. Recovery retries only the
      // read/selection, never the non-idempotent category creation.
      setCreatedId(id);
      setEditor(null);
      const fresh = await source.list();
      if (!current()) return;
      setRows(fresh);
      const row = fresh.find((row) => row.id === id);
      if (!row || !selectableCategory(row, fresh))
        throw new CategoryFailure("unavailable");
      onSelect(id, fresh);
    });
  }
  return {
    ...task,
    rows,
    active,
    root,
    rootId,
    setRootId,
    query,
    setQuery,
    matches,
    recentRows,
    recentError,
    editor,
    setEditor,
    createdId,
    setCreatedId,
    needsReload,
    reload,
    select,
    create
  };
}

const accountFailure = (error: unknown) =>
  error instanceof ClientFailure && error.code === "INVALID_ACCOUNT"
    ? "This account is no longer active or uses a different currency. Choose an active compatible account."
    : "Accounts could not be refreshed. Your draft is preserved. Try again.";
export function useAccountPicker(
  source: AccountSource,
  currency: Currency,
  onSelect: (id: string, rows: Account[]) => void
) {
  const task = usePickerTask(accountFailure);
  const [rows, setRows] = useState<Account[] | null>(null);
  const [query, setQuery] = useState("");
  const reload = useCallback(
    () =>
      task.run(async (current) => {
        const fresh = await source.list();
        if (current()) setRows(fresh);
      }),
    [source, task.run]
  );
  useEffect(() => {
    void reload();
  }, [reload]);
  const eligible = (row: Account) =>
    !row.archivedAt && row.currency === currency;
  const available = (rows ?? []).filter(eligible);
  const matches = available.filter((row) =>
    row.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  );
  function select(id: string) {
    return task.run(async (current) => {
      const fresh = await source.list();
      if (!current()) return;
      setRows(fresh);
      const row = fresh.find((row) => row.id === id);
      if (!row || !eligible(row)) {
        throw new ClientFailure("validation", "INVALID_ACCOUNT");
      }
      onSelect(id, fresh);
    });
  }
  return { ...task, rows, query, setQuery, available, matches, reload, select };
}
