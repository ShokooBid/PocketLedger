import { ClientFailure } from "./auth/transport";
import type {
  Transaction,
  TransactionFilter,
  TransactionPage,
  TransactionSource
} from "./transaction-data";

export type TransactionChange =
  { type: "saved"; row: Transaction } | { type: "deleted"; id: string };
export const transactionKey = (row: Transaction) => `${row.date}_${row.id}`;
export function matchesFilter(row: Transaction, filter: TransactionFilter) {
  return (
    (!filter.from || row.date >= filter.from) &&
    (!filter.to || row.date <= filter.to) &&
    (!filter.categoryId || row.categoryId === filter.categoryId) &&
    (!filter.direction || row.direction === filter.direction)
  );
}
export function reconcileTransactions(
  rows: Transaction[],
  change: TransactionChange,
  filter: TransactionFilter
) {
  const id = change.type === "saved" ? change.row.id : change.id;
  const remaining = rows.filter((row) => row.id !== id);
  if (change.type === "saved" && matchesFilter(change.row, filter))
    remaining.push(change.row);
  return remaining.sort((a, b) =>
    transactionKey(a) < transactionKey(b)
      ? 1
      : transactionKey(a) > transactionKey(b)
        ? -1
        : 0
  );
}
// Append only new IDs. Keep existing rows and their order, including when an
// older page repeats a record whose date changed on the server. Reject malformed
// order/cursors before changing any visible state so a retry uses the same page.
export function appendTransactionPage(
  rows: Transaction[],
  page: TransactionPage,
  after?: string
): Transaction[] {
  const seen = new Set(rows.map((row) => row.id));
  const added: Transaction[] = [];
  let previous = after;
  for (const row of page.items) {
    const key = transactionKey(row);
    if (seen.has(row.id)) continue;
    if (previous && key >= previous) throw new ClientFailure("protocol");
    seen.add(row.id);
    added.push(row);
    previous = key;
  }
  if (
    page.nextCursor &&
    (!page.items.length ||
      (after && page.nextCursor >= after) ||
      page.nextCursor !== transactionKey(page.items.at(-1)!))
  )
    throw new ClientFailure("protocol");
  return [...rows, ...added];
}

// One session-local notification channel keeps mounted history/detail views in
// sync. Nothing is persisted. Listeners cannot turn a confirmed write into failure.
export function observeTransactions(
  source: Omit<TransactionSource, "subscribe">
): TransactionSource {
  const listeners = new Set<(change: TransactionChange) => void>();
  function publish(change: TransactionChange) {
    for (const listener of listeners) {
      try {
        listener(change);
      } catch {
        /* UI listener failures never replay a write. */
      }
    }
  }
  return {
    ...source,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async create(input) {
      const row = await source.create(input);
      publish({ type: "saved", row });
      return row;
    },
    async update(id, input) {
      const row = await source.update(id, input);
      publish({ type: "saved", row });
      return row;
    },
    async remove(id) {
      await source.remove(id);
      publish({ type: "deleted", id });
    }
  };
}
