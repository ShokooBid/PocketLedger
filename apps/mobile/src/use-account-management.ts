import { useCallback, useEffect, useRef, useState } from "react";
import { ClientFailure } from "./auth/transport";
import {
  accountInput,
  parseOpeningBalance,
  type Account,
  type AccountSource
} from "./account-data";
import { uncertainWrite, type Currency } from "./transaction-data";

export type AccountManagementProps = {
  source: AccountSource;
  currency: Currency;
  defaultAccountId: string | null;
  onDefault: (id: string | null) => Promise<void>;
  onReloadPreferences?: () => Promise<void>;
  preferencesReady?: boolean;
  active?: boolean;
};

function actionMessage(failure: unknown) {
  if (failure instanceof ClientFailure) {
    if (failure.code === "ACCOUNT_NAME_CONFLICT")
      return "An active account already uses that name. Choose a distinct name, such as BMO Chequing or BMO Savings.";
    if (failure.code === "PREFERENCE_CHANGED")
      return "Currency settings changed. Reload accounts and review the inherited currency before creating the account.";
    if (failure.code === "ACCOUNT_ARCHIVED")
      return "This account was archived. Reload accounts to review its history.";
    if (failure.kind === "unavailable")
      return "This account is unavailable. Reload your accounts before continuing.";
    if (failure.code === "INVALID_ACCOUNT")
      return "Choose an active account in the configured currency as the default.";
  }
  return "The account action could not be confirmed. Reload accounts and review before another change.";
}

// Settings owns presentation; this hook owns validation, read recovery and writes.
export function useAccountManagement({
  source,
  currency,
  defaultAccountId,
  onDefault,
  onReloadPreferences,
  preferencesReady = true,
  active = true
}: AccountManagementProps) {
  const [rows, setRows] = useState<Account[]>([]);
  const [name, setName] = useState("");
  const [type, setType] = useState<Account["type"]>("bank");
  const [opening, setOpening] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [editing, setEditing] = useState<Account | null>(null);
  const [archiving, setArchiving] = useState<Account | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Awaited<
    ReturnType<AccountSource["get"]>
  > | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const mounted = useRef(false),
    lock = useRef(false);
  const refreshRequested = useRef(false);
  const selected = useRef(selectedId);
  selected.current = selectedId;

  const readDetail = useCallback(
    async (row: Account) => {
      setDetail(null);
      setDetailError(null);
      try {
        // The balance API rejects dates before opening; label future baselines honestly.
        const asOf = [new Date().toISOString().slice(0, 10), row.openingDate]
          .sort()
          .at(-1)!;
        const result = await source.get(row.id, asOf);
        if (mounted.current) setDetail(result);
      } catch {
        if (mounted.current)
          setDetailError(
            "The tracked balance could not be loaded. Reload accounts to try again."
          );
      }
    },
    [source]
  );

  const refresh = useCallback(async () => {
    setDetail(null);
    const accounts = await source.list();
    if (!mounted.current) return;
    setRows(accounts);
    setReady(true);
    const row = accounts.find((row) => row.id === selected.current);
    if (row) await readDetail(row);
    else {
      setSelectedId(null);
      setDetailError(null);
    }
  }, [source, readDetail]);

  const reload = useCallback(async () => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    setReady(false);
    try {
      await Promise.all([refresh(), onReloadPreferences?.()]);
      if (mounted.current) setReviewed(true);
    } catch {
      if (mounted.current) {
        setReady(false);
        setError("Accounts could not be loaded. Reload before making changes.");
      }
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }, [refresh, onReloadPreferences]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (active) refreshRequested.current = true;
  }, [active, reload]);
  useEffect(() => {
    // A focus event during an older read/write still needs a fresh read afterward.
    if (active && !busy && refreshRequested.current) {
      refreshRequested.current = false;
      void reload();
    }
  }, [active, busy, reload]);

  async function viewDetails(row: Account) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setSelectedId(row.id);
    selected.current = row.id;
    await readDetail(row);
    lock.current = false;
    if (mounted.current) setBusy(false);
  }

  async function action(
    operation: "save" | "archive" | "default",
    row?: Account
  ) {
    if (lock.current || uncertain || !ready || !preferencesReady) return;
    let input;
    try {
      if (operation === "save")
        input = accountInput.parse({
          name,
          type,
          currency: editing?.currency ?? currency,
          openingDate: editing?.openingDate ?? date,
          openingBalanceMinor:
            editing?.openingBalanceMinor ??
            parseOpeningBalance(opening, currency)
        });
      if (
        operation === "default" &&
        row &&
        (!rows.some((owned) => owned.id === row.id) ||
          row.archivedAt ||
          row.currency !== currency)
      )
        throw new ClientFailure("validation", "INVALID_ACCOUNT");
    } catch (failure) {
      setError(
        operation === "save"
          ? "Check the account name, signed opening amount and calendar date."
          : actionMessage(failure)
      );
      return;
    }
    lock.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    let confirmed = false;
    try {
      if (operation === "save") {
        const saved = editing
          ? await source.update(editing.id, {
              name: input!.name,
              type: input!.type
            })
          : await source.create(input!);
        if (!mounted.current) return;
        setName("");
        setOpening("");
        setEditing(null);
        setType("bank");
        selected.current = saved.id;
        setSelectedId(saved.id);
        setNotice(
          editing
            ? "Account changes saved."
            : "Account created. Choose it explicitly as your default or select it in your transaction draft."
        );
      } else if (operation === "archive") {
        await source.archive(row!.id);
        if (!mounted.current) return;
        setArchiving(null);
        if (editing?.id === row!.id) {
          setEditing(null);
          setName("");
        }
        // The API clears its default atomically; keep the demo/provider in sync too.
        if (defaultAccountId === row!.id) await onDefault(null);
        setNotice(
          "Account archived. History is preserved; future entries cannot select it."
        );
      } else {
        await onDefault(row?.id ?? null);
        if (mounted.current)
          setNotice(
            row
              ? `${row.name} is the default account.`
              : "Default account cleared."
          );
      }
      confirmed = true;
      await refresh();
    } catch (failure) {
      if (mounted.current) {
        if (confirmed) {
          setReady(false);
          setError(
            "The change was saved, but accounts could not be refreshed. Reload before making another change."
          );
        } else {
          setError(actionMessage(failure));
          if (uncertainWrite(failure)) {
            setUncertain(true);
            setReviewed(false);
          }
        }
      }
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const disabled = busy || uncertain || !ready || !preferencesReady;
  return {
    rows,
    name,
    setName,
    type,
    setType,
    opening,
    setOpening,
    date,
    setDate,
    editing,
    archiving,
    setArchiving,
    selectedId,
    detail,
    detailError,
    busy,
    ready,
    error,
    notice,
    uncertain,
    reviewed,
    disabled,
    reload,
    viewDetails,
    action,
    edit(row: Account) {
      setEditing(row);
      setName(row.name);
      setType(row.type);
      setError(null);
    },
    cancelEditing() {
      setEditing(null);
      setName("");
      setType("bank");
      setError(null);
    },
    acknowledgeReview() {
      setUncertain(false);
      setError(null);
      setNotice(null);
    }
  };
}
