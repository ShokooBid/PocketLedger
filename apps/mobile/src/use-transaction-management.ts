import { randomUUID } from "expo-crypto";
import type { Account, AccountSource } from "./account-data";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Category, CategorySource } from "./category-data";
import { categoryPath, selectableCategory } from "./category-hierarchy";
import { ClientFailure } from "./auth/transport";
import {
  appendTransactionPage,
  matchesFilter,
  reconcileTransactions
} from "./transaction-history";
import {
  amountText,
  validDateFilter,
  draftInput,
  transactionFailureMessage,
  uncertainWrite,
  type Currency,
  type TransactionCreate,
  type Transaction,
  type TransactionDraft,
  type TransactionFilter,
  type TransactionSource
} from "./transaction-data";

export function newDraft(): TransactionDraft {
  const now = new Date();
  return {
    direction: "expense",
    amount: "",
    currency: "CAD",
    date: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`,
    categoryId: "",
    accountId: "",
    note: ""
  };
}
export function useTransactionManagement({
  source,
  categories,
  accounts,
  defaultAccountId = null,
  initialCreate,
  defaultCurrency = "CAD",
  preferencesReady = true,
  active = true,
  detailId
}: {
  source: TransactionSource;
  categories: CategorySource;
  accounts: AccountSource;
  defaultAccountId?: string | null;
  demo?: boolean;
  initialCreate?: { date: string; currency: Currency };
  defaultCurrency?: Currency;
  preferencesReady?: boolean;
  onCurrencySettings?: () => void;
  onAccountSettings?: () => void;
  active?: boolean;
  detailId?: string;
  onOpenDetail?: (id: string) => void;
  onAdd?: () => void;
}) {
  const pendingCreate = useRef<TransactionCreate | null>(null);
  const [accountChoices, setAccountChoices] = useState<Account[]>([]);
  const [accountsReady, setAccountsReady] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);
  const accountRevision = useRef(0);
  const accountLabel = (id: string) =>
    accountChoices.find((row) => row.id === id)?.name ?? "Account unavailable";
  const [rows, setRows] = useState<Transaction[]>([]);
  const [choices, setChoices] = useState<Category[]>([]);
  function categoryLabel(
    id: string | undefined,
    fallback = "Category unavailable"
  ) {
    const row = choices.find((category) => category.id === id);
    return row
      ? categories.hierarchy
        ? categoryPath(row, choices)
        : row.name
      : fallback;
  }
  const [after, setAfter] = useState<string | null>(null);
  const [filter, setFilter] = useState<TransactionFilter>({});
  const [applied, setApplied] = useState<TransactionFilter>({});
  const [draft, setDraft] = useState<TransactionDraft | null>(() =>
    initialCreate
      ? {
          ...newDraft(),
          accountId: defaultAccountId ?? "",
          ...initialCreate
        }
      : null
  );
  const [picker, setPicker] = useState<"category" | "account" | null>(null);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [deleting, setDeleting] = useState<Transaction | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const lock = useRef(false);
  const mounted = useRef(false);
  const revision = useRef(0);
  const appliedRef = useRef(applied);
  appliedRef.current = applied;
  const [loadingMore, setLoadingMore] = useState(false);
  const [retryFilter, setRetryFilter] = useState<TransactionFilter | null>(
    null
  );
  const [deleted, setDeleted] = useState(false);

  useEffect(
    () =>
      source.subscribe((change) => {
        if (
          detailId &&
          (change.type === "saved" ? change.row.id : change.id) !== detailId
        )
          return;
        revision.current++;
        if (detailId) {
          if (change.type === "saved" && change.row.id === detailId)
            setRows([change.row]);
          if (change.type === "deleted" && change.id === detailId) {
            setRows([]);
            setDeleted(true);
            setDraft(null);
            setEditing(null);
            setDeleting(null);
          }
        } else {
          setRows((previous) =>
            reconcileTransactions(previous, change, appliedRef.current)
          );
          // Local edits can move dates across the cursor. Keep the loaded history,
          // but require a fresh first page before continuing this pagination chain.
          if (change.type === "saved") {
            setAfter(null);
            setNotice("History changed. Reload to continue paging.");
          }
        }
      }),
    [source, detailId]
  );

  const read = useCallback(
    async (filter: TransactionFilter, cursor?: string) => {
      if (!detailId) return source.list(filter, cursor);
      try {
        return { items: [await source.get(detailId)], nextCursor: null };
      } catch (error) {
        if (error instanceof ClientFailure && error.kind === "unavailable")
          return { items: [], nextCursor: null };
        throw error;
      }
    },
    [source, detailId]
  );

  useEffect(() => {
    mounted.current = true;
    let active = true;
    lock.current = true;
    setBusy(true);
    const version = revision.current;
    Promise.all([read({}), categories.list()])
      .then(([page, items]) => {
        if (!active) return;
        if (version !== revision.current) {
          setChoices(items);
          setReady(true);
          return;
        }
        setRows(appendTransactionPage([], page));
        setAfter(page.nextCursor);
        setChoices(items);
        setReady(true);
      })
      .catch(() => {
        if (active)
          setError(
            "Transactions could not be loaded. Check your connection and reload."
          );
      })
      .finally(() => {
        if (active) {
          lock.current = false;
          setBusy(false);
        }
      });
    return () => {
      active = false;
      mounted.current = false;
    };
  }, [read, categories]);

  const refreshAccounts = useCallback(async () => {
    const version = ++accountRevision.current;
    setAccountsReady(false);
    setAccountError(null);
    try {
      const items = await accounts.list();
      if (mounted.current && version === accountRevision.current) {
        setAccountChoices(items);
        setAccountsReady(true);
      }
    } catch {
      if (mounted.current && version === accountRevision.current)
        setAccountError(
          "Accounts could not be refreshed. Your draft is preserved. Reload accounts before saving."
        );
    }
  }, [accounts]);
  useEffect(() => {
    if (active && preferencesReady) void refreshAccounts();
    return () => {
      accountRevision.current++;
    };
  }, [
    active,
    preferencesReady,
    refreshAccounts,
    defaultCurrency,
    defaultAccountId
  ]);
  useEffect(() => {
    if (!accountsReady || editing || pendingCreate.current || !defaultAccountId)
      return;
    const account = accountChoices.find((row) => row.id === defaultAccountId);
    if (!account || account.archivedAt) return;
    setDraft((previous) =>
      previous && !previous.accountId && previous.currency === account.currency
        ? { ...previous, accountId: account.id }
        : previous
    );
  }, [accountsReady, accountChoices, defaultAccountId, editing]);

  async function load(nextFilter: TransactionFilter, more = false) {
    if (lock.current) return;
    if (!validDateFilter(nextFilter)) {
      setError(
        "Enter both real dates as YYYY-MM-DD, in order and no more than 366 days apart."
      );
      return;
    }
    lock.current = true;
    setBusy(true);
    setLoadingMore(more);
    setError(null);
    const version = revision.current;
    try {
      const [page, items] = await Promise.all([
        read(nextFilter, more ? (after ?? undefined) : undefined),
        categories.list(),
        refreshAccounts()
      ]);
      if (!mounted.current) return;
      if (version !== revision.current) {
        setError(
          "Transactions changed while loading. Reload to see the latest history."
        );
        return;
      }
      const merged = appendTransactionPage(
        more ? rows : [],
        page,
        more ? (after ?? undefined) : undefined
      );
      setRows(merged);
      setAfter(page.nextCursor);
      setChoices(items);
      setApplied(nextFilter);
      setFilter(nextFilter);
      setRetryFilter(null);
      setReady(true);
      if (uncertain && !more) setReviewed(true);
    } catch {
      if (mounted.current) {
        setError(
          more
            ? "More transactions could not be loaded. Your current rows are unchanged. Try Load more transactions again."
            : "Transactions could not be loaded. Check your connection and reload."
        );
        if (!more) setReady(false);
        setRetryFilter(nextFilter);
      }
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
      if (mounted.current) setLoadingMore(false);
    }
  }
  async function mutate(remove = false, retry = false) {
    if (lock.current || (uncertain && !retry) || !ready || !accountsReady)
      return;
    if (
      !remove &&
      (!preferencesReady || (!editing && draft?.currency !== defaultCurrency))
    ) {
      setError(
        "Reload currency settings or explicitly start a new draft in the configured currency. Your current draft is unchanged."
      );
      return;
    }
    let input;
    // An explicit retry sends the captured payload, regardless of later choices.
    // The server revalidates eligibility if the original row no longer exists.
    if (!remove && !(retry && pendingCreate.current)) {
      try {
        const account = accountChoices.find(
          (row) => row.id === draft!.accountId
        );
        if (
          !account ||
          (account.archivedAt && account.id !== editing?.accountId)
        )
          throw new ClientFailure("validation", "INVALID_ACCOUNT");
        input = draftInput(draft!, account);
      } catch {
        setError(
          "Check amount (positive, within 2147483647 minor units), currency decimals, real date, account, category and note (up to 2000). Text cannot contain control characters."
        );
        return;
      }
    }
    lock.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (remove) {
        await source.remove(deleting!.id);
        if (!mounted.current) return;
        setRows((previous) =>
          previous.filter((row) => row.id !== deleting!.id)
        );
        setDeleting(null);
        setNotice("Transaction deleted.");
      } else {
        const saved = editing
          ? await source.update(editing.id, input!)
          : await source.create(
              (pendingCreate.current ??= {
                ...input!,
                clientRequestId: randomUUID()
              })
            );
        if (!mounted.current) return;
        // Keep the current filters and loaded rows. The confirmed response is
        // authoritative; edits that leave the filter disappear from history.
        setRows((previous) =>
          detailId
            ? [saved]
            : reconcileTransactions(
                previous,
                { type: "saved", row: saved },
                applied
              )
        );
        setAfter(null);
        pendingCreate.current = null;
        setUncertain(false);
        setDraft(null);
        setEditing(null);
        setNotice(
          detailId || matchesFilter(saved, applied)
            ? "Transaction saved. Reload history to continue paging."
            : "Transaction saved. It no longer matches the active filters; clear filters to find it."
        );
      }
    } catch (failure) {
      if (!mounted.current) return;
      setError(transactionFailureMessage(failure));
      if (uncertainWrite(failure)) {
        setUncertain(true);
        setReviewed(false);
      } else {
        pendingCreate.current = null;
      }
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function edit(row?: Transaction) {
    setError(null);
    setNotice(null);
    setDeleting(null);
    pendingCreate.current = null;
    setEditing(row ?? null);
    setDraft(
      row
        ? {
            direction: row.direction,
            amount: amountText(row.amountMinor, row.currency),
            currency: row.currency,
            date: row.date,
            categoryId: row.categoryId,
            accountId: row.accountId,
            note: row.note ?? ""
          }
        : {
            ...newDraft(),
            currency: defaultCurrency,
            accountId: defaultAccountId ?? ""
          }
    );
  }
  const draftCurrencyMismatch =
    draft !== null && !editing && draft.currency !== defaultCurrency;
  const draftAccountUnavailable =
    !!draft?.accountId &&
    !accountChoices.some(
      (row) =>
        row.id === draft.accountId &&
        row.currency === draft.currency &&
        (!row.archivedAt || row.id === editing?.accountId)
    );
  const draftCategoryUnavailable =
    !!draft?.categoryId &&
    draft.categoryId !== editing?.categoryId &&
    !choices.some(
      (row) => row.id === draft.categoryId && selectableCategory(row, choices)
    );
  const draftHistoricalCategory =
    !!draft &&
    draft.categoryId === editing?.categoryId &&
    choices.some(
      (row) => row.id === draft.categoryId && !selectableCategory(row, choices)
    );
  const draftHistoricalAccount =
    !!draft &&
    draft.accountId === editing?.accountId &&
    accountChoices.some(
      (row) => row.id === draft.accountId && !!row.archivedAt
    );
  function selectCategory(id: string, items: Category[]) {
    setChoices(items);
    setDraft((previous) =>
      previous ? { ...previous, categoryId: id } : previous
    );
    setPicker(null);
  }
  function selectAccount(id: string, items: Account[]) {
    accountRevision.current++;
    setAccountChoices(items);
    setAccountsReady(true);
    setAccountError(null);
    setDraft((previous) =>
      previous ? { ...previous, accountId: id } : previous
    );
    setPicker(null);
  }
  const disabled =
    busy || uncertain || !ready || !preferencesReady || !accountsReady;
  return {
    rows,
    choices,
    accountChoices,
    accountsReady,
    accountError,
    refreshAccounts,
    accountLabel,
    categoryLabel,
    after,
    filter,
    setFilter,
    applied,
    draft,
    setDraft,
    editing,
    setEditing,
    deleting,
    setDeleting,
    busy,
    ready,
    error,
    notice,
    uncertain,
    setUncertain,
    reviewed,
    retryFilter,
    loadingMore,
    deleted,
    disabled,
    draftCurrencyMismatch,
    draftAccountUnavailable,
    draftCategoryUnavailable,
    draftHistoricalCategory,
    draftHistoricalAccount,
    picker,
    setPicker,
    selectCategory,
    selectAccount,
    load,
    mutate,
    edit,
    setError,
    pendingCreate
  };
}
