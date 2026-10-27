import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import type { Category, CategorySource } from "./category-data";
import { Body, Button, Field, StateNotice } from "./ui";
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
  demo = false
}: {
  source: TransactionSource;
  categories: CategorySource;
  demo?: boolean;
}) {
  const [rows, setRows] = useState<Transaction[]>([]);
  const [choices, setChoices] = useState<Category[]>([]);
  const [after, setAfter] = useState<string | null>(null);
  const [filter, setFilter] = useState<TransactionFilter>({});
  const [applied, setApplied] = useState<TransactionFilter>({});
  const [draft, setDraft] = useState<TransactionDraft | null>(null);
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

  useEffect(() => {
    mounted.current = true;
    let active = true;
    lock.current = true;
    setBusy(true);
    Promise.all([source.list({}), categories.list()])
      .then(([page, items]) => {
        if (!active) return;
        setRows(page.items);
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
  }, [source, categories]);

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
    setError(null);
    try {
      const [page, items] = await Promise.all([
        source.list(nextFilter, more ? (after ?? undefined) : undefined),
        categories.list()
      ]);
      if (!mounted.current) return;
      if (more && page.nextCursor === after) throw new Error("pagination");
      setRows((previous) =>
        more
          ? [
              ...previous,
              ...page.items.filter(
                (row) => !previous.some((old) => old.id === row.id)
              )
            ]
          : page.items
      );
      setAfter(page.nextCursor);
      setChoices(items);
      setApplied(nextFilter);
      setReady(true);
      if (uncertain && !more) setReviewed(true);
    } catch {
      if (mounted.current) {
        setError(
          "Transactions could not be loaded. Check your connection and reload."
        );
        setReady(false);
      }
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
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
        // Show the confirmed response immediately, even outside the old filters.
        setRows([saved]);
        setAfter(null);
        setFilter({});
        setApplied({});
        setDraft(null);
        setEditing(null);
        setNotice("Transaction saved.");
        try {
          const page = await source.list({});
          if (!mounted.current) return;
          setRows(
            page.items.some((row) => row.id === saved.id)
              ? page.items
              : [saved, ...page.items]
          );
          setAfter(page.nextCursor);
        } catch {
          if (mounted.current) {
            setReady(false);
            setError(
              "Transaction saved, but the list could not be refreshed. Reload the list; do not submit the saved transaction again."
            );
          }
        }
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
        : newDraft()
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
        <StateNotice kind="loading" title="Working" message="Please wait." />
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
        onPress={() => void load(uncertain ? {} : applied)}
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
        label="Add transaction"
        disabled={disabled}
        onPress={() => edit()}
      />
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
      {ready && !rows.length && <Body>No transactions match this view.</Body>}
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
