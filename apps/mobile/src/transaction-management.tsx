import { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";
import type { Category, CategorySource } from "./category-data";
import { Body, Button, Field, StateNotice } from "./ui";
import { ClientFailure } from "./auth/transport";
import {
  appendTransactionPage,
  matchesFilter,
  reconcileTransactions
} from "./transaction-history";
import {
  amountText,
  validDateFilter,
  currencyExponents,
  draftInput,
  transactionFailureMessage,
  uncertainWrite,
  type Currency,
  type Transaction,
  type TransactionDraft,
  type TransactionFilter,
  type TransactionSource
} from "./transaction-data";

function newDraft(): TransactionDraft {
  const now = new Date();
  return {
    direction: "expense",
    amount: "",
    currency: "USD",
    date: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`,
    categoryId: "",
    merchant: "",
    note: ""
  };
}
export function TransactionManagement({
  source,
  categories,
  demo = false,
  initialCreate,
  defaultCurrency = "USD",
  detailId,
  onOpenDetail
}: {
  source: TransactionSource;
  categories: CategorySource;
  demo?: boolean;
  initialCreate?: { date: string; currency: Currency };
  defaultCurrency?: Currency;
  detailId?: string;
  onOpenDetail?: (id: string) => void;
}) {
  const [rows, setRows] = useState<Transaction[]>([]);
  const [choices, setChoices] = useState<Category[]>([]);
  const [after, setAfter] = useState<string | null>(null);
  const [filter, setFilter] = useState<TransactionFilter>({});
  const [applied, setApplied] = useState<TransactionFilter>({});
  const [draft, setDraft] = useState<TransactionDraft | null>(() =>
    initialCreate ? { ...newDraft(), ...initialCreate } : null
  );
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
        categories.list()
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
  async function mutate(remove = false) {
    if (lock.current || uncertain || !ready) return;
    let input;
    if (!remove) {
      try {
        input = draftInput(draft!);
      } catch {
        setError(
          "Check amount (positive, within 2147483647 minor units), currency decimals, real date, category, merchant (1–200) and note (up to 2000). Text cannot contain control characters."
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
          : await source.create(input!);
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
    setEditing(row ?? null);
    setDraft(
      row
        ? {
            direction: row.direction,
            amount: amountText(row.amountMinor, row.currency),
            currency: row.currency,
            date: row.date,
            categoryId: row.categoryId,
            merchant: row.merchant,
            note: row.note ?? ""
          }
        : { ...newDraft(), currency: defaultCurrency }
    );
  }
  const disabled = busy || uncertain || !ready;
  return (
    <>
      {demo && (
        <Body>
          Demo only: transactions stay in memory and are discarded when you
          exit. No API requests or persistent data.
        </Body>
      )}
      {busy && (
        <StateNotice
          kind="loading"
          title={loadingMore ? "Loading more transactions" : "Working"}
          message={
            loadingMore ? "Your current history stays visible." : "Please wait."
          }
        />
      )}
      {error && (
        <StateNotice
          kind="error"
          title="Transaction action needs attention"
          message={error}
        />
      )}
      {notice && <Body>{notice}</Body>}
      <Button
        label="Reload transactions and categories"
        disabled={busy}
        onPress={() => void load(uncertain ? {} : (retryFilter ?? applied))}
      />
      {uncertain && (
        <>
          <Body>
            Your entered values are retained. The write may have succeeded.
            Review the reloaded list before another submission; no write is
            retried automatically.
          </Body>
          <Button
            label="I reviewed the list; enable changes"
            disabled={busy || !reviewed || !ready}
            onPress={() => {
              setUncertain(false);
              setError(null);
              setDeleting(null);
            }}
          />
        </>
      )}
      {!detailId && !(initialCreate && draft) && (
        <>
          <Body>
            {Object.values(applied).some(Boolean)
              ? `Active filters: ${applied.from ?? "any date"}${applied.to ? ` to ${applied.to}` : ""}, ${applied.direction ?? "all directions"}, ${choices.find((category) => category.id === applied.categoryId)?.name ?? "all categories"}.`
              : "Showing all transactions."}
          </Body>
          <Field
            label="From date filter (YYYY-MM-DD)"
            value={filter.from ?? ""}
            editable={!busy}
            onChangeText={(from) => setFilter({ ...filter, from })}
          />
          <Field
            label="To date filter (YYYY-MM-DD)"
            value={filter.to ?? ""}
            editable={!busy}
            onChangeText={(to) => setFilter({ ...filter, to })}
          />
          {([undefined, "income", "expense"] as const).map((direction) => (
            <Button
              key={direction ?? "all"}
              label={`Filter: ${direction ?? "all directions"}`}
              selected={filter.direction === direction}
              disabled={busy}
              onPress={() =>
                setFilter((previous) => {
                  const next = { ...previous };
                  if (direction) next.direction = direction;
                  else delete next.direction;
                  return next;
                })
              }
            />
          ))}
          <Button
            label="Filter: all categories"
            disabled={busy}
            selected={!filter.categoryId}
            onPress={() =>
              setFilter((previous) => {
                const next = { ...previous };
                delete next.categoryId;
                return next;
              })
            }
          />
          {choices.map((category) => (
            <Button
              key={category.id}
              label={`Filter category: ${category.name}${category.archivedAt ? " (archived)" : ""}`}
              selected={filter.categoryId === category.id}
              disabled={busy}
              onPress={() => setFilter({ ...filter, categoryId: category.id })}
            />
          ))}
          <Button
            label="Apply filters"
            disabled={busy || uncertain}
            onPress={() => void load(filter)}
          />
          <Button
            label="Clear filters"
            disabled={busy || uncertain}
            onPress={() => void load({})}
          />
          <Button
            label="Add transaction"
            variant="primary"
            disabled={disabled}
            onPress={() => edit()}
          />
        </>
      )}
      {draft && (
        <View>
          <Body>{editing ? "Edit transaction" : "New transaction"}</Body>
          {(["expense", "income"] as const).map((direction) => (
            <Button
              key={direction}
              label={direction === "expense" ? "Expense" : "Income"}
              selected={draft.direction === direction}
              disabled={busy || uncertain}
              onPress={() => setDraft({ ...draft, direction })}
            />
          ))}
          <Field
            label="Amount"
            value={draft.amount}
            keyboardType="decimal-pad"
            editable={!busy && !uncertain}
            onChangeText={(amount) => setDraft({ ...draft, amount })}
          />
          {(Object.keys(currencyExponents) as Currency[]).map((currency) => (
            <Button
              key={currency}
              label={`Currency ${currency}`}
              selected={draft.currency === currency}
              disabled={busy || uncertain}
              onPress={() => setDraft({ ...draft, currency })}
            />
          ))}
          <Body>
            {currencyExponents[draft.currency]} decimal places allowed. Use a
            period as decimal separator.
          </Body>
          <Field
            label="Transaction date (YYYY-MM-DD)"
            value={draft.date}
            editable={!busy && !uncertain}
            onChangeText={(date) => setDraft({ ...draft, date })}
          />
          {!choices.some((category) => !category.archivedAt) && (
            <Body>
              Create an active category on the Categories screen, then reload
              here.
            </Body>
          )}
          {choices
            .filter(
              (category) =>
                !category.archivedAt || category.id === editing?.categoryId
            )
            .map((category) => (
              <Button
                key={category.id}
                label={`Category: ${category.name}${category.archivedAt ? " (archived history)" : ""}`}
                selected={draft.categoryId === category.id}
                disabled={busy || uncertain}
                onPress={() => setDraft({ ...draft, categoryId: category.id })}
              />
            ))}
          <Field
            label="Merchant or payee"
            value={draft.merchant}
            maxLength={200}
            editable={!busy && !uncertain}
            onChangeText={(merchant) => setDraft({ ...draft, merchant })}
          />
          <Field
            label="Note (optional)"
            value={draft.note}
            maxLength={2000}
            editable={!busy && !uncertain}
            onChangeText={(note) => setDraft({ ...draft, note })}
          />
          <Button
            label="Save transaction"
            variant="primary"
            disabled={disabled}
            onPress={() => void mutate()}
          />
          <Button
            label="Cancel editing"
            disabled={busy || uncertain}
            onPress={() => {
              setDraft(null);
              setEditing(null);
            }}
          />
        </View>
      )}
      {ready && !rows.length && (
        <Body>
          {detailId
            ? deleted
              ? "Transaction deleted. Return to history to continue."
              : "This transaction is unavailable. It may have been deleted or may not belong to this account."
            : "No transactions match this view."}
        </Body>
      )}
      {rows.map((row) => (
        <View key={row.id}>
          <Body>
            {row.date} · {row.direction} ·{" "}
            {amountText(row.amountMinor, row.currency)} {row.currency} ·{" "}
            {row.merchant}
          </Body>
          <Body>
            {choices.find((category) => category.id === row.categoryId)?.name ??
              "Category unavailable"}
          </Body>
          {row.note && <Body>{row.note}</Body>}
          {detailId && (
            <>
              <Body>Created: {row.createdAt}</Body>
              <Body>Last updated: {row.updatedAt}</Body>
            </>
          )}
          {!detailId && onOpenDetail && (
            <Button
              label={`View details for ${row.merchant}`}
              disabled={disabled}
              onPress={() => onOpenDetail(row.id)}
            />
          )}
          <Button
            label={`Edit ${row.merchant}`}
            disabled={disabled}
            onPress={() => edit(row)}
          />
          <Button
            label={`Delete ${row.merchant}`}
            disabled={disabled}
            onPress={() => {
              setDeleting(row);
              setDraft(null);
            }}
          />
        </View>
      ))}
      {after && (
        <Button
          label="Load more transactions"
          disabled={busy}
          onPress={() => void load(applied, true)}
        />
      )}
      {deleting && (
        <View>
          <Body>
            Delete {deleting.merchant}? This permanently removes the
            transaction.
          </Body>
          <Button
            label="Confirm delete transaction"
            disabled={disabled}
            onPress={() => void mutate(true)}
          />
          <Button
            label="Keep transaction"
            disabled={busy || uncertain}
            onPress={() => setDeleting(null)}
          />
        </View>
      )}
    </>
  );
}
