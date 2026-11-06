import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren
} from "react";
import { currencySchema, type Currency } from "./transaction-data";
import { useSession } from "./session";
import { ClientFailure } from "./auth/transport";
import {
  createApiPreferencesSource,
  preferenceFailureMessage,
  type CurrencyPreferences,
  type CurrencySettingsState
} from "./preference-data";
import { Screen, StateNotice } from "./ui";

type Preferences = {
  selectedCurrency: Currency | null;
  hasActiveAccounts: boolean;
  // Existing finance widgets require a concrete type. This fallback is never a
  // persisted choice; FinanceSetup hides them until selection is complete.
  defaultCurrency: Currency;
  defaultAccountId: string | null;
  setDefaultAccount: (id: string | null) => Promise<void>;
  setDefaultCurrency: (currency: Currency) => Promise<void>;
  currencyState: CurrencySettingsState;
  assertNewCurrency: (currency: Currency) => void;
  accountsChanged: (hasActiveAccounts: boolean) => Promise<void>;
};
type State = {
  data: CurrencyPreferences;
  initialized: boolean;
  status: "loading" | "ready" | "error";
  saving: boolean;
  error: string | null;
};
const Context = createContext<Preferences | null>(null);

// The session-keyed parent clears these closures/data on account/demo changes.
export function PreferencesProvider({ children }: PropsWithChildren) {
  const { session, controller } = useSession();
  const [source] = useState(() => {
    if (session.status === "demo") return null;
    if (session.status !== "authenticated")
      throw new Error("Preferences require an application session.");
    return createApiPreferencesSource(controller.client(session.generation));
  });
  const [state, setState] = useState<State>(() => ({
    data: {
      entryCurrency: null,
      hasActiveAccounts: false,
      defaultAccountId: null
    },
    initialized: session.status === "demo",
    status: session.status === "demo" ? "ready" : "loading",
    saving: false,
    error: null
  }));
  const current = useRef(state);
  const mounted = useRef(false);
  const inFlight = useRef(false);
  const pendingRead = useRef<Promise<void> | null>(null);
  const revision = useRef(0);
  const apply = useCallback((next: State) => {
    current.current = next;
    if (mounted.current) setState(next);
  }, []);
  const reload = useCallback((): Promise<void> => {
    if (inFlight.current) return pendingRead.current ?? Promise.resolve();
    inFlight.current = true;
    const version = revision.current;
    apply({ ...current.current, status: "loading", error: null });
    const request = (async () => {
      try {
        const data = source ? await source.get() : current.current.data;
        if (mounted.current && version === revision.current)
          apply({
            data,
            initialized: true,
            status: "ready",
            saving: false,
            error: null
          });
      } catch (error) {
        if (mounted.current && version === revision.current)
          apply({
            ...current.current,
            status: "error",
            error: preferenceFailureMessage(error)
          });
      } finally {
        if (version === revision.current) inFlight.current = false;
      }
    })();
    pendingRead.current = request;
    return request;
  }, [source, apply]);
  useEffect(() => {
    mounted.current = true;
    void reload();
    return () => {
      mounted.current = false;
      revision.current++;
      inFlight.current = false;
    };
  }, [reload]);
  const setDefaultCurrency = useCallback(
    async (value: Currency) => {
      if (!mounted.current) return;
      const currency = currencySchema.parse(value);
      if (inFlight.current || current.current.status !== "ready") return;
      if (current.current.data.entryCurrency !== null) {
        if (current.current.data.entryCurrency !== currency)
          apply({
            ...current.current,
            status: "error",
            error: preferenceFailureMessage(
              new ClientFailure("conflict", "CURRENCY_LOCKED")
            )
          });
        return;
      }
      inFlight.current = true;
      const version = revision.current;
      apply({ ...current.current, saving: true, error: null });
      try {
        const data = source
          ? await source.update(currency)
          : {
              ...current.current.data,
              entryCurrency: currency
            };
        if (mounted.current && version === revision.current)
          apply({
            data,
            initialized: true,
            status: "ready",
            saving: false,
            error: null
          });
      } catch (error) {
        if (mounted.current && version === revision.current)
          apply({
            ...current.current,
            status: "error",
            saving: false,
            error: preferenceFailureMessage(error)
          });
      } finally {
        if (version === revision.current) inFlight.current = false;
      }
    },
    [source, apply]
  );
  const assertNewCurrency = useCallback((currency: Currency) => {
    if (current.current.status !== "ready" || current.current.saving)
      throw new ClientFailure("validation", "PREFERENCES_NOT_READY");
    if (current.current.data.entryCurrency === null)
      throw new ClientFailure("validation", "CURRENCY_REQUIRED");
    if (current.current.data.entryCurrency !== currency)
      throw new ClientFailure("validation", "CURRENCY_MISMATCH");
  }, []);
  const accountsChanged = useCallback(
    async (hasActiveAccounts: boolean) => {
      if (source) {
        // A read started before an account mutation may contain the old count.
        // Wait for it, then obtain a new snapshot rather than dropping the refresh.
        await pendingRead.current;
        await reload();
      } else {
        apply({
          ...current.current,
          data: {
            ...current.current.data,
            hasActiveAccounts,
            defaultAccountId: hasActiveAccounts
              ? current.current.data.defaultAccountId
              : null
          }
        });
      }
    },
    [source, reload, apply]
  );
  const setDefaultAccount = useCallback(
    async (id: string | null) => {
      if (inFlight.current || current.current.status !== "ready")
        throw new ClientFailure("validation", "PREFERENCES_NOT_READY");
      inFlight.current = true;
      const version = revision.current;
      apply({ ...current.current, saving: true, error: null });
      try {
        const data = source
          ? await source.selectAccount(id)
          : { ...current.current.data, defaultAccountId: id };
        if (mounted.current && version === revision.current)
          apply({ ...current.current, data, saving: false });
      } catch (error) {
        if (mounted.current && version === revision.current)
          apply({
            ...current.current,
            status: "error",
            saving: false,
            error: preferenceFailureMessage(error)
          });
        throw error;
      } finally {
        if (version === revision.current) inFlight.current = false;
      }
    },
    [source, apply]
  );
  return (
    <Context.Provider
      value={{
        selectedCurrency: state.data.entryCurrency,
        hasActiveAccounts: state.data.hasActiveAccounts,
        defaultCurrency: state.data.entryCurrency ?? "CAD",
        defaultAccountId: state.data.defaultAccountId,
        setDefaultAccount,
        setDefaultCurrency,
        assertNewCurrency,
        accountsChanged,
        currencyState: {
          initialized: state.initialized,
          status: state.status,
          saving: state.saving,
          error: state.error,
          reload
        }
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function usePreferences() {
  const preferences = useContext(Context);
  if (!preferences) throw new Error("PreferencesProvider is required.");
  return preferences;
}

export function PreferencesReady({ children }: PropsWithChildren) {
  const { currencyState, selectedCurrency, hasActiveAccounts } =
    usePreferences();
  const ready =
    currencyState.status === "ready" &&
    selectedCurrency !== null &&
    hasActiveAccounts;
  const [admitted, setAdmitted] = useState(false);
  useEffect(() => {
    if (ready) setAdmitted(true);
  }, [ready]);
  // Do not initialize finance drafts until setup first succeeds. Afterwards a
  // failed refresh/account repair must not unmount and erase an existing draft;
  // the central FinanceSetup boundary hides it until access is ready again.
  if (ready || admitted) return <>{children}</>;
  return (
    <Screen title="Currency settings">
      <StateNotice
        kind={currencyState.status === "error" ? "error" : "loading"}
        title={
          currencyState.status === "error"
            ? "Currency settings unavailable"
            : "Loading currency settings"
        }
        message={
          currencyState.error ??
          "Preparing your saved currency before opening finance screens."
        }
        {...(currencyState.status === "error"
          ? { onRetry: () => void currencyState.reload() }
          : {})}
      />
    </Screen>
  );
}
