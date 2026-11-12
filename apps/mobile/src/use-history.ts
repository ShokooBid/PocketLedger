import { useCallback, useEffect, useRef, useState } from "react";
import type { AccountSource, Account } from "./account-data";
import type { CategorySource, Category } from "./category-data";
import { currentMonth, monthRange } from "./dashboard-data";
import {
  historyFailureMessage,
  mergeHistory,
  validHistoryFilters,
  type HistoryFilters,
  type HistoryFocus,
  type HistoryPage,
  type HistoryPosition,
  type HistorySource
} from "./history-data";

export type HistoryProps = {
  source: HistorySource;
  accounts: Pick<AccountSource, "list">;
  categories: Pick<CategorySource, "list">;
  changes: { subscribe(listener: () => void): () => void };
  active: boolean;
  ready: boolean;
  focus?: HistoryFocus;
  initialAccountId?: string;
  onFocusConsumed?: () => void;
  onAccountConsumed?: () => void;
};
export function useHistory({
  source,
  accounts,
  categories,
  changes,
  active,
  ready,
  focus,
  initialAccountId,
  onFocusConsumed,
  onAccountConsumed
}: HistoryProps) {
  const [filter, setFilter] = useState<HistoryFilters>(() => ({
    ...monthRange(currentMonth()),
    ...(initialAccountId ? { accountId: initialAccountId } : {})
  }));
  const [page, setPage] = useState<HistoryPage | null>(null);
  const [accountChoices, setAccountChoices] = useState<Account[]>([]);
  const [categoryChoices, setCategoryChoices] = useState<Category[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false),
    [reload, setReload] = useState(0);
  const sequence = useRef(0),
    pageRef = useRef(page),
    appliedRef = useRef(filter),
    focusRef = useRef(focus);
  const mounted = useRef(false),
    lock = useRef(false),
    retry = useRef<{
      filter: HistoryFilters;
      position: HistoryPosition;
      direction?: "older" | "newer";
    } | null>(null);
  const consumed = useRef(onFocusConsumed),
    lastFocus = useRef(focus ? `${focus.kind}_${focus.id}` : "");
  const accountConsumed = useRef(onAccountConsumed),
    pendingAccount = useRef(initialAccountId),
    lastAccount = useRef(initialAccountId ?? "");
  consumed.current = onFocusConsumed;
  accountConsumed.current = onAccountConsumed;
  pageRef.current = page;
  const invalidate = useCallback(() => {
    sequence.current++;
    lock.current = false;
    setStale(true);
    setReload((value) => value + 1);
  }, []);
  const load = useCallback(
    async (
      next: HistoryFilters,
      position: HistoryPosition = {},
      direction?: "older" | "newer"
    ) => {
      if (lock.current) return;
      if (!validHistoryFilters(next)) {
        setError(
          "Enter both real dates as YYYY-MM-DD, in order and no more than 366 days apart."
        );
        return;
      }
      lock.current = true;
      const request = ++sequence.current;
      setBusy(true);
      setError(null);
      if (!direction) setStale(true);
      retry.current = {
        filter: next,
        position,
        ...(direction ? { direction } : {})
      };
      try {
        const [result, accountRows, categoryRows] = await Promise.all([
          source.list(next, position),
          accounts.list(),
          categories.list()
        ]);
        if (!mounted.current || request !== sequence.current) return;
        const merged =
          direction && pageRef.current
            ? mergeHistory(pageRef.current, result, direction)
            : result;
        pageRef.current = merged;
        setPage(merged);
        setAccountChoices(accountRows);
        setCategoryChoices(categoryRows);
        appliedRef.current = result.applied;
        setFilter(result.applied);
        setStale(false);
        retry.current = null;
        if (position.focus) {
          focusRef.current = undefined;
          consumed.current?.();
        }
        if (pendingAccount.current) {
          pendingAccount.current = undefined;
          accountConsumed.current?.();
        }
      } catch (failure) {
        if (mounted.current && request === sequence.current) {
          setError(historyFailureMessage(failure));
          setStale(true);
        }
      } finally {
        if (mounted.current && request === sequence.current) {
          lock.current = false;
          setBusy(false);
        }
      }
    },
    [source, accounts, categories]
  );
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      sequence.current++;
    };
  }, []);
  useEffect(() => changes.subscribe(invalidate), [changes, invalidate]);
  useEffect(() => {
    const key = focus ? `${focus.kind}_${focus.id}` : "";
    if (focus && key !== lastFocus.current) {
      focusRef.current = focus;
      invalidate();
    }
    lastFocus.current = key;
  }, [focus, invalidate]);
  useEffect(() => {
    const key = initialAccountId ?? "";
    if (initialAccountId && key !== lastAccount.current) {
      pendingAccount.current = initialAccountId;
      appliedRef.current = {
        ...monthRange(currentMonth()),
        accountId: initialAccountId
      };
      invalidate();
    }
    lastAccount.current = key;
  }, [initialAccountId, invalidate]);
  useEffect(() => {
    if (!active || !ready) {
      sequence.current++;
      lock.current = false;
      setBusy(false);
      return;
    }
    lock.current = false;
    void load(
      appliedRef.current,
      focusRef.current ? { focus: focusRef.current } : {}
    );
    return () => {
      sequence.current++;
      lock.current = false;
    };
  }, [active, ready, load, reload]);
  return {
    filter,
    setFilter,
    page,
    accountChoices,
    categoryChoices,
    busy,
    error,
    stale,
    apply: () => {
      if (!validHistoryFilters(filter)) {
        setError(
          "Enter both real dates as YYYY-MM-DD, in order and no more than 366 days apart."
        );
        return;
      }
      void load(filter);
    },
    clear: () => {
      focusRef.current = undefined;
      consumed.current?.();
      pendingAccount.current = undefined;
      accountConsumed.current?.();
      void load({});
    },
    selectMonth: (month: string) =>
      void load({ ...filter, ...monthRange(month) }),
    refresh: () => {
      const attempt = retry.current;
      if (attempt)
        void load(attempt.filter, attempt.position, attempt.direction);
      else void load(appliedRef.current);
    },
    more: (direction: "older" | "newer") => {
      const current = pageRef.current,
        cursor =
          direction === "older" ? current?.nextCursor : current?.previousCursor;
      if (!cursor || stale) return;
      void load(
        appliedRef.current,
        direction === "older" ? { after: cursor } : { before: cursor },
        direction
      );
    }
  };
}
