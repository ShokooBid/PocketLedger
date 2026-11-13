import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren
} from "react";
import { AppState, Modal, Platform } from "react-native";
import { randomUUID } from "expo-crypto";
import type { Account } from "./account-data";
import type { Category } from "./category-data";
import {
  useAccounts,
  useTransactions,
  useTransfers,
  useFinanceChanges
} from "./transaction-context";
import { useCategories } from "./category-context";
import { usePreferences } from "./preferences";
import {
  entryErrors,
  entryInput,
  freshEntry,
  localDate,
  transferEntryInput,
  type EntryDraft,
  type EntryErrors
} from "./entry-data";
import {
  uncertainWrite,
  amountText,
  transactionFailureMessage,
  type Transaction,
  type TransactionInput,
  type TransactionCreate
} from "./transaction-data";
import {
  transferFailureMessage,
  type Transfer,
  type TransferCreate,
  type TransferInput
} from "./transfer-data";
import { Button, Screen, Body } from "./ui";
import { ClientFailure } from "./auth/transport";

type PendingWrite =
  | { kind: "transaction"; input: TransactionCreate }
  | { kind: "transaction-edit"; id: string; input: TransactionInput }
  | { kind: "transfer"; input: TransferCreate }
  | { kind: "transfer-edit"; id: string; input: TransferInput };
type TransferReview = {
  input: TransferInput;
  from: Account;
  to: Account;
};

function useEntryState() {
  const accountSource = useAccounts(),
    categorySource = useCategories(),
    source = useTransactions(),
    transfers = useTransfers();
  const preferences = usePreferences();
  const changes = useFinanceChanges();
  const [draft, setDraft] = useState(() =>
    freshEntry(preferences.defaultCurrency)
  );
  const [accounts, setAccounts] = useState<Account[]>([]),
    [categories, setCategories] = useState<Category[]>([]);
  const [accountsReady, setReady] = useState(false),
    [categoriesReady, setCategoriesReady] = useState(false),
    [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [reviewed, setReviewed] = useState(false);
  const [errors, setErrors] = useState<EntryErrors>({}),
    [message, setMessage] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [confirmation, setConfirmation] = useState<TransferReview | null>(null),
    [editingTransaction, setEditingTransaction] = useState<Transaction | null>(
      null
    ),
    [editingTransfer, setEditingTransfer] = useState<Transfer | null>(null);
  const [saved, setSaved] = useState<{
    id: string;
    kind: "transaction" | "transfer";
  } | null>(null);
  const ready =
    accountsReady && (draft.direction === "transfer" || categoriesReady);
  const pending = useRef<PendingWrite | null>(null),
    locked = useRef(false),
    mounted = useRef(false),
    revision = useRef(0);
  const initialized = useRef(false),
    dateEdited = useRef(false);
  const addDraftBeforeEdit = useRef<{
    draft: EntryDraft;
    initialized: boolean;
    dateEdited: boolean;
  } | null>(null);
  const [leaving, setLeaving] = useState<{ action: () => void } | null>(null);
  const activeAccounts = accounts.filter(
    (row) => !row.archivedAt && row.currency === preferences.selectedCurrency
  );
  const account = accounts.find((row) => row.id === draft.accountId);
  const financeReady =
    preferences.currencyState.status === "ready" &&
    !preferences.currencyState.saving &&
    preferences.hasActiveAccounts &&
    preferences.selectedCurrency !== null;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      revision.current++;
    };
  }, []);
  useEffect(() => {
    if (Platform.OS !== "web" || (!dirty && !busy && !uncertain)) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, busy, uncertain]);

  const reload = useCallback(async () => {
    const version = ++revision.current;
    setLoading(true);
    setReady(false);
    setReadError(null);
    try {
      const [nextAccounts, nextCategories] = await Promise.allSettled([
        accountSource.list(),
        categorySource.list()
      ]);
      if (!mounted.current || version !== revision.current) return;
      if (nextAccounts.status === "rejected") throw nextAccounts.reason;
      setAccounts(nextAccounts.value);
      setCategoriesReady(nextCategories.status === "fulfilled");
      if (nextCategories.status === "fulfilled")
        setCategories(nextCategories.value);
      else
        setReadError(
          "Categories could not be loaded. Reload before saving income or expenses; transfers use accounts only."
        );
      setReady(true);
    } catch {
      if (mounted.current && version === revision.current)
        setReadError(
          "Accounts or categories could not be loaded. Your draft is kept; reload before saving."
        );
    } finally {
      if (mounted.current && version === revision.current) setLoading(false);
    }
  }, [accountSource, categorySource]);
  useEffect(() => {
    if (financeReady) void reload();
  }, [financeReady, reload]);
  useEffect(() => {
    if (
      !ready ||
      dirty ||
      locked.current ||
      pending.current ||
      initialized.current
    )
      return;
    initialized.current = true;
    const selected = activeAccounts.find(
      (row) => row.id === preferences.defaultAccountId
    );
    setDraft((previous) => ({
      ...previous,
      currency: preferences.defaultCurrency,
      accountId: selected?.id ?? "",
      date: dateEdited.current ? previous.date : localDate()
    }));
    // Account defaults only initialize pristine drafts. Never overwrite a user's choice.
  }, [
    ready,
    dirty,
    accounts,
    preferences.defaultAccountId,
    preferences.defaultCurrency
  ]);
  useEffect(() => {
    if (!ready || locked.current || pending.current || draft.accountId) return;
    const selected = activeAccounts.find(
      (row) =>
        row.id === preferences.defaultAccountId &&
        row.currency === draft.currency
    );
    if (selected)
      setDraft((previous) =>
        previous.accountId ? previous : { ...previous, accountId: selected.id }
      );
  }, [
    ready,
    accounts,
    preferences.defaultAccountId,
    draft.accountId,
    draft.currency
  ]);
  useEffect(() => {
    const updateToday = () => {
      if (!dateEdited.current && !locked.current && !pending.current)
        setDraft((previous) => ({ ...previous, date: localDate() }));
    };
    const timer = setInterval(updateToday, 30_000);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") updateToday();
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [dirty]);
  function change(patch: Partial<EntryDraft>) {
    if (locked.current || pending.current || confirmation) return;
    if (
      (editingTransfer || editingTransaction) &&
      patch.direction &&
      patch.direction !== draft.direction
    )
      return;
    if (patch.date !== undefined) dateEdited.current = true;
    setDirty(true);
    setErrors({});
    setMessage(null);
    setDraft((previous) => ({ ...previous, ...patch }));
  }
  function resetDraft() {
    const previousAdd = addDraftBeforeEdit.current;
    addDraftBeforeEdit.current = null;
    initialized.current = previousAdd?.initialized ?? false;
    dateEdited.current = previousAdd?.dateEdited ?? false;
    pending.current = null;
    setConfirmation(null);
    setEditingTransaction(null);
    setEditingTransfer(null);
    setUncertain(false);
    setReviewed(false);
    setErrors({});
    setMessage(null);
    setDirty(false);
    setDraft(
      previousAdd?.draft ??
        freshEntry(
          preferences.defaultCurrency,
          preferences.defaultAccountId ?? ""
        )
    );
  }
  function requestDiscard(action?: () => void) {
    const proceed = action ?? resetDraft;
    if (dirty || pending.current || locked.current)
      setLeaving({ action: proceed });
    else proceed();
  }
  async function review() {
    if (locked.current || !pending.current) return;
    locked.current = true;
    setBusy(true);
    try {
      // A successful read establishes connectivity, not proof that a create failed.
      // Only replaying the frozen identity can safely resolve the original create.
      if (pending.current.kind === "transaction") await source.list({});
      else if (pending.current.kind === "transaction-edit") {
        const row = await source.get(pending.current.id),
          input = pending.current.input;
        if (
          Object.entries(input).every(
            ([key, value]) => row[key as keyof Transaction] === value
          )
        ) {
          finishSave(row, "transaction");
          changes.invalidate();
          return;
        }
      } else if (pending.current.kind === "transfer-edit") {
        const row = await transfers.get(pending.current.id),
          input = pending.current.input;
        if (
          Object.entries(input).every(
            ([key, value]) => row[key as keyof Transfer] === value
          )
        ) {
          finishSave(row, "transfer");
          changes.invalidate();
          return;
        }
      } else await transfers.list({});
      if (mounted.current) {
        setReviewed(true);
        setMessage(
          "Connection checked. Retry the original save with the same identity; no new request will be started."
        );
      }
    } catch (failure) {
      if (
        (pending.current?.kind === "transfer-edit" ||
          pending.current?.kind === "transaction-edit") &&
        failure instanceof ClientFailure &&
        failure.kind === "unavailable"
      ) {
        const unavailableKind = pending.current.kind;
        pending.current = null;
        if (mounted.current) {
          setUncertain(false);
          setReviewed(false);
          setMessage(
            unavailableKind === "transfer-edit"
              ? "This transfer is no longer available. Your values are kept. Cancel transfer editing and review History before starting a new transfer."
              : "This transaction is no longer available. Your values are kept. Cancel transaction editing and review History before starting a new transaction."
          );
          changes.invalidate();
          void reload();
        }
        return;
      }
      if (mounted.current)
        setMessage(
          "Saved entries could not be checked. Keep this draft and try again."
        );
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function finishSave(
    row: Transaction | Transfer,
    kind: "transaction" | "transfer"
  ) {
    if (!mounted.current) return;
    pending.current = null;
    setConfirmation(null);
    setEditingTransaction(null);
    setEditingTransfer(null);
    setUncertain(false);
    setReviewed(false);
    setErrors({});
    setDirty(false);
    const previousAdd = addDraftBeforeEdit.current;
    addDraftBeforeEdit.current = null;
    if (previousAdd) {
      initialized.current = previousAdd.initialized;
      dateEdited.current = previousAdd.dateEdited;
    }
    setDraft(
      previousAdd?.draft ??
        ((previous) => ({ ...previous, amount: "", note: "" }))
    );
    setSaved({ id: row.id, kind });
    setMessage(
      kind === "transfer"
        ? "Transfer saved. Opening History."
        : "Transaction saved. Opening History."
    );
    void reload();
  }
  async function save(retry = false, confirmed = false) {
    if (
      locked.current ||
      !financeReady ||
      !ready ||
      (pending.current && (!retry || !reviewed))
    )
      return;
    if (!pending.current) {
      if (confirmed && !confirmation) return;
      const nextErrors = entryErrors(draft, accounts, categories);
      setErrors(nextErrors);
      if (Object.keys(nextErrors).length) {
        if (confirmed) setConfirmation(null);
        return;
      }
      const selected = accounts.find((row) => row.id === draft.accountId)!;
      if (selected.currency !== preferences.selectedCurrency) {
        if (confirmed) setConfirmation(null);
        setErrors({
          accountId: "Choose an active account in your permanent currency."
        });
        return;
      }
      if (draft.direction === "transfer") {
        const input = confirmation?.input ?? transferEntryInput(draft);
        if (!confirmed) {
          setConfirmation({
            input,
            from: selected,
            to: accounts.find((row) => row.id === draft.toAccountId)!
          });
          return;
        }
        pending.current = editingTransfer
          ? {
              kind: "transfer-edit",
              id: editingTransfer.id,
              input: Object.freeze({ ...input })
            }
          : {
              kind: "transfer",
              input: Object.freeze({ ...input, clientRequestId: randomUUID() })
            };
        setConfirmation(null);
      } else {
        const input = entryInput(draft, selected);
        pending.current = editingTransaction
          ? {
              kind: "transaction-edit",
              id: editingTransaction.id,
              input: Object.freeze(input)
            }
          : {
              kind: "transaction",
              input: Object.freeze({ ...input, clientRequestId: randomUUID() })
            };
      }
    }
    locked.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const write = pending.current!;
      if (write.kind === "transaction" || write.kind === "transaction-edit") {
        const row =
          write.kind === "transaction"
            ? await source.create(write.input)
            : await source.update(write.id, write.input);
        finishSave(row, "transaction");
      } else
        finishSave(
          write.kind === "transfer"
            ? await transfers.create(write.input)
            : await transfers.update(write.id, write.input),
          "transfer"
        );
    } catch (failure) {
      if (!mounted.current) return;
      if (uncertainWrite(failure)) {
        setUncertain(true);
        setReviewed(false);
      } else {
        pending.current = null;
        setUncertain(false);
      }
      setMessage(
        draft.direction === "transfer"
          ? transferFailureMessage(failure)
          : transactionFailureMessage(failure)
      );
      if (!uncertainWrite(failure)) void reload();
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return {
    draft,
    confirmation,
    cancelConfirmation() {
      if (!locked.current) setConfirmation(null);
    },
    editingTransfer,
    editingTransaction,
    saved,
    consumeSaved() {
      setSaved(null);
    },
    account,
    accounts,
    categories,
    activeAccounts,
    ready,
    loading,
    busy,
    uncertain,
    reviewed,
    errors,
    message,
    readError,
    dirty,
    financeReady,
    modeDisabled:
      busy || uncertain || !!confirmation || !accountsReady || !financeReady,
    disabled: busy || uncertain || !!confirmation || !ready || !financeReady,
    change,
    reload,
    save,
    review,
    requestDiscard,
    cancelEditing(action: () => void) {
      requestDiscard(() => {
        resetDraft();
        action();
      });
    },
    leaving,
    setLeaving,
    selectAccount(id: string, rows: Account[], side: "from" | "to" = "from") {
      if (locked.current || pending.current) return;
      const selected = rows.find(
        (row) =>
          row.id === id &&
          !row.archivedAt &&
          !(
            draft.direction === "transfer" &&
            row.id === (side === "from" ? draft.toAccountId : draft.accountId)
          ) &&
          row.currency === preferences.selectedCurrency
      );
      if (!selected) return;
      setAccounts(rows);
      // A stale currency assertion is never silently reinterpreted by selection.
      if (dirty && draft.currency !== selected.currency) {
        setMessage(
          "Discard this stale-currency draft before choosing a new currency account."
        );
        return;
      }
      change({
        [side === "to" ? "toAccountId" : "accountId"]: id,
        currency: selected.currency
      });
    },
    selectCategory(id: string, rows: Category[]) {
      setCategories(rows);
      change({ categoryId: id });
    },
    applyLink(link: { date?: string; currency?: EntryDraft["currency"] }) {
      if (locked.current || pending.current || dirty) {
        setMessage(
          "Your existing draft was kept. Discard it explicitly before starting from another link."
        );
        return;
      }
      if (link.currency && link.currency !== preferences.selectedCurrency) {
        setMessage(
          "This add link uses a different currency. No amount or preference was changed. Start a new entry in your permanent currency."
        );
        return;
      }
      if (link.date) change({ date: link.date });
    },
    editTransfer(row: Transfer, action: () => void) {
      if (locked.current || pending.current) {
        setMessage("Resolve the current save before editing another transfer.");
        return;
      }
      requestDiscard(() => {
        addDraftBeforeEdit.current = dirty
          ? null
          : {
              draft,
              initialized: initialized.current,
              dateEdited: dateEdited.current
            };
        dateEdited.current = true;
        initialized.current = true;
        setEditingTransfer(row);
        setEditingTransaction(null);
        setConfirmation(null);
        setErrors({});
        setMessage(null);
        setDirty(true);
        setDraft({
          direction: "transfer",
          amount: amountText(row.amountMinor, row.currency),
          currency: row.currency,
          accountId: row.fromAccountId,
          toAccountId: row.toAccountId,
          categoryId: "",
          date: row.date,
          note: row.note ?? ""
        });
        action();
      });
    },
    editTransaction(row: Transaction, action: () => void) {
      if (locked.current || pending.current) {
        setMessage(
          "Resolve the current save before editing another transaction."
        );
        return;
      }
      requestDiscard(() => {
        addDraftBeforeEdit.current = dirty
          ? null
          : {
              draft,
              initialized: initialized.current,
              dateEdited: dateEdited.current
            };
        dateEdited.current = true;
        initialized.current = true;
        setEditingTransaction(row);
        setEditingTransfer(null);
        setConfirmation(null);
        setErrors({});
        setMessage(null);
        setDirty(true);
        setDraft({
          direction: row.direction,
          amount: amountText(row.amountMinor, row.currency),
          currency: row.currency,
          accountId: row.accountId,
          toAccountId: "",
          categoryId: row.categoryId,
          date: row.date,
          note: row.note ?? ""
        });
        action();
      });
    }
  };
}

const Context = createContext<ReturnType<typeof useEntryState> | null>(null);
export function EntryProvider({ children }: PropsWithChildren) {
  const state = useEntryState();
  return (
    <Context.Provider value={state}>
      {children}
      <Modal
        visible={state.leaving !== null}
        transparent={false}
        animationType="slide"
        onRequestClose={() => state.setLeaving(null)}
      >
        <Screen
          title={
            state.draft.direction === "transfer"
              ? "Discard transfer draft?"
              : "Discard transaction draft?"
          }
          showUserMenu={false}
        >
          <Body>
            {state.busy
              ? "Wait for the current save or review to finish before leaving."
              : state.uncertain
                ? "The save may already have succeeded. Leaving loses its retry identity. Review saved history before creating another transaction. Hard deletion also removes server replay protection."
                : `Your unsaved ${state.draft.direction === "transfer" ? "transfer" : "transaction"} will be lost. You can switch tabs or open Settings without discarding it.`}
          </Body>
          <Button
            label={
              state.draft.direction === "transfer"
                ? "Keep transfer draft"
                : "Keep transaction draft"
            }
            onPress={() => state.setLeaving(null)}
          />
          <Button
            label="Confirm discard draft"
            disabled={state.busy}
            onPress={() => {
              const action = state.leaving?.action;
              state.setLeaving(null);
              action?.();
            }}
          />
        </Screen>
      </Modal>
      <Modal
        visible={state.confirmation !== null}
        animationType="slide"
        onRequestClose={state.cancelConfirmation}
      >
        <Screen
          title={
            state.editingTransfer
              ? "Review transfer changes"
              : "Review transfer"
          }
          showUserMenu={false}
        >
          {state.confirmation && (
            <>
              <Body>From Account: {state.confirmation.from.name}</Body>
              <Body>To Account: {state.confirmation.to.name}</Body>
              <Body>
                Amount:{" "}
                {amountText(
                  state.confirmation.input.amountMinor,
                  state.confirmation.from.currency
                )}{" "}
                {state.confirmation.from.currency}
              </Body>
              <Body>Date: {state.confirmation.input.date}</Body>
              <Body>
                Description: {state.confirmation.input.note || "None"}
              </Body>
              <Body>
                The From balance decreases and the To balance increases by this
                amount. Income and spending stay unchanged.
              </Body>
              <Button
                label={
                  state.editingTransfer
                    ? "Confirm transfer changes"
                    : "Confirm transfer"
                }
                variant="primary"
                disabled={state.busy || !state.ready || !state.financeReady}
                onPress={() => void state.save(false, true)}
              />
              <Button
                label="Return to transfer draft"
                disabled={state.busy}
                onPress={state.cancelConfirmation}
              />
            </>
          )}
        </Screen>
      </Modal>
    </Context.Provider>
  );
}
export function useEntry() {
  const state = useContext(Context);
  if (!state) throw new Error("EntryProvider is required.");
  return state;
}
