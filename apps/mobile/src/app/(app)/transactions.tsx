import { Button, Screen, StateNotice } from "../../ui";
import { useCategories } from "../../category-context";
import {
  useTransactions,
  useAccounts,
  useTransfers,
  useFinanceChanges
} from "../../transaction-context";
import { TransferManagement } from "../../transfer-management";
import { useEntry } from "../../entry-context";
import { TransactionManagement } from "../../transaction-management";
import { useSession } from "../../session";
import {
  Redirect,
  useFocusEffect,
  useLocalSearchParams,
  useRouter
} from "expo-router";
import { parseAddLink } from "../../entry-data";
import { PreferencesReady, usePreferences } from "../../preferences";
import { useCallback, useEffect, useRef, useState } from "react";
import { HistoryScreen } from "../../history-screen";
import { createApiHistorySource, historyFocus } from "../../history-data";
import { z } from "zod";

export default function TransactionsRoute() {
  return (
    <PreferencesReady>
      <TransactionsScreen />
    </PreferencesReady>
  );
}
function TransactionsScreen() {
  const source = useTransactions();
  const transfers = useTransfers(),
    changes = useFinanceChanges(),
    entry = useEntry();
  const accounts = useAccounts();
  const categories = useCategories();
  const { session, controller } = useSession();
  const [history] = useState(() =>
    session.status === "authenticated"
      ? createApiHistorySource(controller.client(session.generation))
      : null
  );
  const {
    defaultCurrency,
    defaultAccountId,
    hasActiveAccounts,
    currencyState
  } = usePreferences();
  const router = useRouter();
  const [active, setActive] = useState(false);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [selectionBusy, setSelectionBusy] = useState(false);
  const selection = useRef(0);
  useEffect(
    () => () => {
      selection.current++;
    },
    []
  );
  useFocusEffect(
    useCallback(() => {
      setActive(true);
      void currencyState.reload();
      return () => setActive(false);
    }, [currencyState.reload])
  );
  const { action, date, currency, focusId, focusKind, accountId } =
    useLocalSearchParams();
  const focus =
    focusId !== undefined || focusKind !== undefined
      ? historyFocus.safeParse({ id: focusId, kind: focusKind })
      : null;
  const account =
    accountId !== undefined ? z.uuid().safeParse(accountId) : null;
  const initialCreate = action === "add" ? parseAddLink(date, currency) : null;
  const openDraftSettings = () =>
    router.push({
      pathname: "/settings",
      params: { returnTo: "transaction-draft" }
    });
  if (action !== undefined && !initialCreate)
    return (
      <Screen title="Transactions" back>
        <StateNotice
          kind="error"
          title="Invalid add transaction request"
          message="Open Add to start a transaction. Your existing draft is unchanged."
        />
      </Screen>
    );
  if (initialCreate)
    return <Redirect href={{ pathname: "/", params: initialCreate }} />;
  if (history)
    return (
      <Screen title="History">
        {(focus && !focus.success) || (account && !account.success) ? (
          <>
            <StateNotice
              kind="error"
              title="Invalid history selection"
              message="Clear the selection to open History again."
            />
            <Button
              label="Clear history selection"
              onPress={() =>
                router.setParams({
                  focusId: undefined,
                  focusKind: undefined,
                  accountId: undefined
                })
              }
            />
          </>
        ) : (
          <>
            {selectionError && (
              <StateNotice
                kind="error"
                title="Could not open record"
                message={selectionError}
              />
            )}
            {selectionBusy && (
              <StateNotice
                kind="loading"
                title="Opening record"
                message="Loading its current values."
              />
            )}
            <HistoryScreen
              source={history}
              accounts={accounts}
              categories={categories}
              changes={changes}
              active={active}
              ready={
                currencyState.status === "ready" &&
                !currencyState.saving &&
                hasActiveAccounts
              }
              writeBlocked={entry.busy || entry.uncertain || selectionBusy}
              {...(focus?.success ? { focus: focus.data } : {})}
              {...(account?.success ? { initialAccountId: account.data } : {})}
              onFocusConsumed={() =>
                router.setParams({ focusId: undefined, focusKind: undefined })
              }
              onAccountConsumed={() =>
                router.setParams({ accountId: undefined })
              }
              onSelect={(row) => {
                if (selectionBusy || entry.busy || entry.uncertain) return;
                const request = ++selection.current;
                setSelectionError(null);
                setSelectionBusy(true);
                void (async () => {
                  try {
                    if (row.kind === "transfer") {
                      const current = await transfers.get(row.id);
                      if (request === selection.current)
                        entry.editTransfer(current, () => router.navigate("/"));
                    } else {
                      const current = await source.get(row.id);
                      if (request === selection.current)
                        entry.editTransaction(current, () =>
                          router.navigate("/")
                        );
                    }
                  } catch {
                    if (request === selection.current)
                      setSelectionError(
                        "The record could not be loaded. Refresh History and try again."
                      );
                  } finally {
                    if (request === selection.current) setSelectionBusy(false);
                  }
                })();
              }}
            />
          </>
        )}
      </Screen>
    );
  return (
    <Screen title="History">
      <TransactionManagement
        onAdd={() => router.navigate("/")}
        defaultCurrency={defaultCurrency}
        defaultAccountId={defaultAccountId}
        accounts={accounts}
        active={active}
        preferencesReady={
          currencyState.status === "ready" &&
          !currencyState.saving &&
          hasActiveAccounts
        }
        onCurrencySettings={openDraftSettings}
        onAccountSettings={openDraftSettings}
        source={source}
        categories={categories}
        demo={session.status === "demo"}
        {...(focus?.success && focus.data.kind === "transaction"
          ? { focusId: focus.data.id }
          : {})}
        onFocusConsumed={() =>
          router.setParams({ focusId: undefined, focusKind: undefined })
        }
        onEdit={(row) => entry.editTransaction(row, () => router.navigate("/"))}
        onOpenDetail={(id) =>
          router.push({ pathname: "/transactions/[id]", params: { id } })
        }
      />
      <TransferManagement
        source={transfers}
        {...(focus?.success && focus.data.kind === "transfer"
          ? { focusId: focus.data.id }
          : {})}
        onFocusConsumed={() =>
          router.setParams({ focusId: undefined, focusKind: undefined })
        }
        accounts={accounts}
        active={active}
        writeBlocked={entry.busy || entry.uncertain}
        onReconciled={changes.invalidate}
        onEdit={(row) => entry.editTransfer(row, () => router.navigate("/"))}
        onOpenDetail={(id) =>
          router.push({ pathname: "/transfers/[id]", params: { id } })
        }
      />
    </Screen>
  );
}
