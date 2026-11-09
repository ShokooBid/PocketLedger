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
import { useAccounts, useTransactions } from "./transaction-context";
import { useCategories } from "./category-context";
import { usePreferences } from "./preferences";
import {
  entryErrors,
  entryInput,
  freshEntry,
  localDate,
  type EntryErrors
} from "./entry-data";
import {
  uncertainWrite,
  transactionFailureMessage,
  type TransactionCreate,
  type TransactionDraft
} from "./transaction-data";
import { Button, Screen, Body } from "./ui";

function useEntryState() {
  const accountSource = useAccounts(),
    categorySource = useCategories(),
    source = useTransactions();
  const preferences = usePreferences();
  const [draft, setDraft] = useState(() =>
    freshEntry(preferences.defaultCurrency)
  );
  const [accounts, setAccounts] = useState<Account[]>([]),
    [categories, setCategories] = useState<Category[]>([]);
  const [ready, setReady] = useState(false),
    [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [reviewed, setReviewed] = useState(false);
  const [errors, setErrors] = useState<EntryErrors>({}),
    [message, setMessage] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const pending = useRef<TransactionCreate | null>(null),
    locked = useRef(false),
    mounted = useRef(false),
    revision = useRef(0);
  const initialized = useRef(false),
    dateEdited = useRef(false);
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
      const [nextAccounts, nextCategories] = await Promise.all([
        accountSource.list(),
        categorySource.list()
      ]);
      if (!mounted.current || version !== revision.current) return;
      setAccounts(nextAccounts);
      setCategories(nextCategories);
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
  function change(patch: Partial<TransactionDraft>) {
    if (locked.current || pending.current) return;
    if (patch.date !== undefined) dateEdited.current = true;
    setDirty(true);
    setErrors({});
    setMessage(null);
    setDraft((previous) => ({ ...previous, ...patch }));
  }
  function requestDiscard(action?: () => void) {
    const proceed =
      action ??
      (() => {
        initialized.current = false;
        dateEdited.current = false;
        pending.current = null;
        setUncertain(false);
        setReviewed(false);
        setErrors({});
        setMessage(null);
        setDirty(false);
        setDraft(
          freshEntry(
            preferences.defaultCurrency,
            preferences.defaultAccountId ?? ""
          )
        );
      });
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
      await source.list({});
      if (mounted.current) {
        setReviewed(true);
        setMessage(
          "Connection checked. Retry the original save with the same identity; no new request will be started."
        );
      }
    } catch {
      if (mounted.current)
        setMessage(
          "Saved transactions could not be checked. Keep this draft and try again."
        );
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function save(retry = false) {
    if (
      locked.current ||
      !financeReady ||
      !ready ||
      (pending.current && (!retry || !reviewed))
    )
      return;
    if (!pending.current) {
      const nextErrors = entryErrors(draft, accounts, categories);
      setErrors(nextErrors);
      if (Object.keys(nextErrors).length) return;
      const selected = accounts.find((row) => row.id === draft.accountId)!;
      if (selected.currency !== preferences.selectedCurrency) {
        setErrors({
          accountId: "Choose an active account in your permanent currency."
        });
        return;
      }
      pending.current = {
        ...entryInput(draft, selected),
        clientRequestId: randomUUID()
      };
    }
    locked.current = true;
    setBusy(true);
    setMessage(null);
    try {
      await source.create(pending.current!);
      if (!mounted.current) return;
      pending.current = null;
      setUncertain(false);
      setReviewed(false);
      setErrors({});
      setDirty(false);
      // Keep direction/account/category/date for rapid entry. Only amount/note clear.
      setDraft((previous) => ({ ...previous, amount: "", note: "" }));
      setMessage("Transaction saved. Ready for the next entry.");
      // Subscription notifications refresh history/overview. Account details read
      // balances on focus; refresh entry choices independently of save success.
      void reload();
    } catch (failure) {
      if (!mounted.current) return;
      if (uncertainWrite(failure)) {
        setUncertain(true);
        setReviewed(false);
      } else {
        pending.current = null;
        setUncertain(false);
      }
      setMessage(transactionFailureMessage(failure));
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return {
    draft,
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
    disabled: busy || uncertain || !ready || !financeReady,
    change,
    reload,
    save,
    review,
    requestDiscard,
    leaving,
    setLeaving,
    selectAccount(id: string, rows: Account[]) {
      if (locked.current || pending.current) return;
      const selected = rows.find(
        (row) =>
          row.id === id &&
          !row.archivedAt &&
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
      change({ accountId: id, currency: selected.currency });
    },
    selectCategory(id: string, rows: Category[]) {
      setCategories(rows);
      change({ categoryId: id });
    },
    applyLink(link: {
      date?: string;
      currency?: TransactionDraft["currency"];
    }) {
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
        <Screen title="Discard transaction draft?" showUserMenu={false}>
          <Body>
            {state.busy
              ? "Wait for the current save or review to finish before leaving."
              : state.uncertain
                ? "The save may already have succeeded. Leaving loses its retry identity. Review saved history before creating another transaction. Hard deletion also removes server replay protection."
                : "Your unsaved transaction will be lost. You can switch tabs or open Settings without discarding it."}
          </Body>
          <Button
            label="Keep transaction draft"
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
    </Context.Provider>
  );
}
export function useEntry() {
  const state = useContext(Context);
  if (!state) throw new Error("EntryProvider is required.");
  return state;
}
