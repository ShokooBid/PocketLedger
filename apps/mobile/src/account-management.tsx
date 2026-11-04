import { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { Body, Button, Field, StateNotice } from "./ui";
import {
  accountInput,
  parseOpeningBalance,
  type Account,
  type AccountSource
} from "./account-data";
import { amountText, type Currency, uncertainWrite } from "./transaction-data";

export function AccountManagement({
  source,
  currency,
  defaultAccountId,
  onDefault,
  preferencesReady = true
}: {
  source: AccountSource;
  currency: Currency;
  defaultAccountId: string | null;
  onDefault: (id: string | null) => Promise<void>;
  preferencesReady?: boolean;
}) {
  const [rows, setRows] = useState<Account[]>([]),
    [name, setName] = useState(""),
    [type, setType] = useState<Account["type"]>("bank");
  const [opening, setOpening] = useState(""),
    [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [editing, setEditing] = useState<Account | null>(null),
    [archiving, setArchiving] = useState<Account | null>(null);
  const [busy, setBusy] = useState(false),
    [ready, setReady] = useState(false),
    [error, setError] = useState<string | null>(null),
    [uncertain, setUncertain] = useState(false);
  const [balance, setBalance] = useState<{
    id: string;
    asOf: string;
    balanceMinor: number;
  } | null>(null);
  const mounted = useRef(false),
    lock = useRef(false);
  const reload = useCallback(async () => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      const accounts = await source.list();
      if (mounted.current) {
        setRows(accounts);
        setReady(true);
        setError(null);
        setUncertain(false);
      }
    } catch {
      if (mounted.current) {
        setReady(false);
        setError("Accounts could not be loaded. Reload before making changes.");
      }
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }, [source]);
  useEffect(() => {
    mounted.current = true;
    void reload();
    return () => {
      mounted.current = false;
    };
  }, [reload]);
  async function action(
    operation: "save" | "archive" | "default" | "balance",
    row?: Account
  ) {
    if (
      lock.current ||
      (operation !== "balance" && (uncertain || !ready || !preferencesReady))
    )
      return;
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
    } catch {
      setError(
        "Check the account name, signed opening amount and calendar date."
      );
      return;
    }
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      if (operation === "save") {
        if (editing)
          await source.update(editing.id, {
            name: input!.name,
            type: input!.type
          });
        else await source.create(input!);
        if (mounted.current) {
          setName("");
          setOpening("");
          setEditing(null);
        }
      } else if (operation === "archive") {
        await source.archive(row!.id);
        if (defaultAccountId === row!.id) await onDefault(null);
        if (mounted.current) setArchiving(null);
      } else if (operation === "default") await onDefault(row?.id ?? null);
      else {
        const asOf = [new Date().toISOString().slice(0, 10), row!.openingDate]
          .sort()
          .at(-1)!;
        const result = await source.get(row!.id, asOf);
        if (mounted.current) setBalance(result);
      }
      const accounts = await source.list();
      if (mounted.current) setRows(accounts);
    } catch (failure) {
      if (mounted.current) {
        setError(
          "The account action could not be confirmed. Reload accounts and review before another change."
        );
        if (operation !== "balance" && uncertainWrite(failure))
          setUncertain(true);
      }
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <View>
      <Body>Financial accounts</Body>
      <Body>
        Names describe your own tracking accounts. No bank connection is
        created.
      </Body>
      {busy && <Body>Loading accounts or confirming a change.</Body>}
      {error && (
        <StateNotice
          kind="error"
          title="Accounts need attention"
          message={error}
        />
      )}
      <Button
        label="Reload accounts"
        disabled={busy}
        onPress={() => void reload()}
      />
      {!rows.length && ready && !busy && (
        <Body>Create an account before recording transactions.</Body>
      )}
      {rows.map((row) => (
        <View key={row.id}>
          <Body>
            {row.name} · {row.currency}
            {row.archivedAt ? " (archived)" : ""}
            {defaultAccountId === row.id ? " (default)" : ""}
          </Body>
          <Button
            label={`View balance for ${row.name}`}
            disabled={busy}
            onPress={() => void action("balance", row)}
          />
          {balance?.id === row.id && (
            <Body>
              Balance as of {balance.asOf}:{" "}
              {balance.balanceMinor < 0 ? "-" : ""}
              {amountText(Math.abs(balance.balanceMinor), row.currency)}{" "}
              {row.currency}
            </Body>
          )}
          {!row.archivedAt && (
            <>
              <Button
                label={`Rename ${row.name}`}
                disabled={busy || uncertain || !ready || !preferencesReady}
                onPress={() => {
                  setEditing(row);
                  setName(row.name);
                  setType(row.type);
                }}
              />
              {row.currency === currency && (
                <Button
                  label={`Use ${row.name} as default`}
                  disabled={busy || uncertain || !ready || !preferencesReady}
                  onPress={() => void action("default", row)}
                />
              )}
              <Button
                label={`Archive ${row.name}`}
                disabled={busy || uncertain || !ready || !preferencesReady}
                onPress={() => setArchiving(row)}
              />
            </>
          )}
        </View>
      ))}
      {defaultAccountId && (
        <Button
          label="Clear default account"
          disabled={busy || uncertain || !ready || !preferencesReady}
          onPress={() => void action("default")}
        />
      )}
      {archiving && (
        <>
          <Body>
            Archive {archiving.name}? Historical transactions are preserved.
          </Body>
          <Button
            label="Confirm archive account"
            disabled={busy || uncertain || !ready || !preferencesReady}
            onPress={() => void action("archive", archiving)}
          />
          <Button label="Keep account" onPress={() => setArchiving(null)} />
        </>
      )}
      <Body>
        {editing ? "Rename account" : "Add account"} · Currency:{" "}
        {editing?.currency ?? currency}
      </Body>
      <Field
        label="Account name"
        value={name}
        editable={!busy && !uncertain}
        onChangeText={setName}
      />
      {(["cash", "bank", "credit", "other"] as const).map((value) => (
        <Button
          key={value}
          label={`Account type ${value}`}
          selected={type === value}
          disabled={busy || uncertain || !ready || !preferencesReady}
          onPress={() => setType(value)}
        />
      ))}
      {!editing && (
        <>
          <Field
            label="Opening balance (optional)"
            value={opening}
            editable={!busy && !uncertain}
            onChangeText={setOpening}
          />
          <Field
            label="Account opening date (YYYY-MM-DD)"
            value={date}
            editable={!busy && !uncertain}
            onChangeText={setDate}
          />
        </>
      )}
      <Button
        label={editing ? "Save account changes" : "Create account"}
        disabled={busy || uncertain || !ready || !preferencesReady}
        onPress={() => void action("save")}
      />
      {editing && (
        <Button
          label="Cancel account editing"
          onPress={() => {
            setEditing(null);
            setName("");
          }}
        />
      )}
    </View>
  );
}
