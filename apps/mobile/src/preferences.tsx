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
import { NavigationLink, Screen, StateNotice } from "./ui";

type Preferences = {
  defaultCurrency: Currency;
  defaultAccountId: string | null;
  setDefaultAccount: (id: string | null) => Promise<void>;
  setDefaultCurrency: (currency: Currency) => Promise<void>;
  currencyState: CurrencySettingsState;
  assertNewCurrency: (currency: Currency) => void;
  transactionSaved: () => void;
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
      entryCurrency: "CAD",
      currencyLocked: false,
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
  const revision = useRef(0);
  const apply = useCallback((next: State) => {
    current.current = next;
    if (mounted.current) setState(next);
  }, []);
  const reload = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    const version = revision.current;
    apply({ ...current.current, status: "loading", error: null });
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
      if (inFlight.current) return;
      if (
        current.current.status !== "ready" ||
        current.current.data.currencyLocked
      )
        return;
      inFlight.current = true;
      const version = revision.current;
      apply({ ...current.current, saving: true, error: null });
      try {
        const data = source
          ? await source.update(currency)
          : {
              ...current.current.data,
              entryCurrency: currency,
              defaultAccountId:
                currency === current.current.data.entryCurrency
                  ? current.current.data.defaultAccountId
                  : null
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
    if (current.current.data.entryCurrency !== currency)
      throw new ClientFailure("validation", "CURRENCY_MISMATCH");
  }, []);
  const transactionSaved = useCallback(() => {
    revision.current++;
    inFlight.current = false;
    apply({
      ...current.current,
      data: { ...current.current.data, currencyLocked: true },
      status: "ready",
      saving: false
    });
  }, [apply]);
  const setDefaultAccount = useCallback(
    async (id: string | null) => {
      if (inFlight.current || current.current.status !== "ready") return;
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
      } finally {
        if (version === revision.current) inFlight.current = false;
      }
    },
    [source, apply]
  );
  return (
    <Context.Provider
      value={{
        defaultCurrency: state.data.entryCurrency,
        defaultAccountId: state.data.defaultAccountId,
        setDefaultAccount,
        setDefaultCurrency,
        assertNewCurrency,
        transactionSaved,
        currencyState: {
          initialized: state.initialized,
          status: state.status,
          locked: state.data.currencyLocked,
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
  const { currencyState } = usePreferences();
  // A failed refresh after initialization must not unmount and erase a draft.
  if (currencyState.initialized) return <>{children}</>;
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
      <NavigationLink href="/settings" label="Open settings" />
    </Screen>
  );
}
