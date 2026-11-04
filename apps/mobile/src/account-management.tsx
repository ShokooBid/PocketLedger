import { StyleSheet, Text, View } from "react-native";
import { Body, Button, Field, StateNotice } from "./ui";
import { amountText } from "./transaction-data";
import { theme } from "./theme";
import {
  useAccountManagement,
  type AccountManagementProps
} from "./use-account-management";

export function AccountManagement(props: AccountManagementProps) {
  const { currency, defaultAccountId, preferencesReady = true } = props;
  const state = useAccountManagement(props);
  const { busy, disabled } = state;
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.heading}>
        Financial accounts
      </Text>
      <Body>
        Names describe your own tracking accounts, such as BMO Chequing, BMO
        Savings, CIBC or Cash. No bank connection is created.
      </Body>
      {busy && (
        <StateNotice
          kind="loading"
          title="Loading accounts or confirming a change"
          message="Please wait. Your entered account values are retained."
        />
      )}
      {!preferencesReady && (
        <StateNotice
          kind="loading"
          title="Waiting for currency settings"
          message="Reload currency settings before changing accounts or defaults."
        />
      )}
      {state.error && (
        <StateNotice
          kind="error"
          title="Accounts need attention"
          message={state.error}
        />
      )}
      {state.notice && (
        <View
          accessible
          accessibilityLiveRegion="polite"
          accessibilityLabel={state.notice}
        >
          <Body>{state.notice}</Body>
        </View>
      )}
      <Button
        label="Reload accounts"
        disabled={busy}
        onPress={() => void state.reload()}
      />
      {state.uncertain && (
        <>
          <Body>
            The change may have succeeded. Reload and review your accounts
            before another change. No write is retried automatically.
          </Body>
          <Button
            label="I reviewed accounts; enable changes"
            disabled={busy || !state.ready || !state.reviewed}
            onPress={state.acknowledgeReview}
          />
        </>
      )}
      {!state.rows.length && state.ready && !busy && (
        <StateNotice
          kind="empty"
          title="No financial accounts yet"
          message="Create an account before recording transactions. Your transaction draft stays available while you do this."
        />
      )}
      {state.rows.map((row) => (
        <View key={row.id} style={styles.card}>
          <Text accessibilityRole="header" style={styles.heading}>
            {row.name} · {row.currency}
            {row.archivedAt ? " (archived)" : ""}
            {defaultAccountId === row.id ? " (default)" : ""}
          </Text>
          <Body>
            Type: {row.type} · Status: {row.archivedAt ? "Archived" : "Active"}
          </Body>
          {row.currency !== currency && (
            <Body>
              Settings uses {currency}. This account retains {row.currency}; no
              money was converted. It cannot be the default for new entries in{" "}
              {currency}.
            </Body>
          )}
          <Button
            label={`View balance for ${row.name}`}
            hint="Shows account details, opening information and tracked balance."
            disabled={busy || !state.ready}
            selected={state.selectedId === row.id}
            onPress={() => void state.viewDetails(row)}
          />
          {state.selectedId === row.id && (
            <View style={styles.section}>
              <Text accessibilityRole="header" style={styles.heading}>
                Account details: {row.name}
              </Text>
              <Body>Currency: {row.currency}</Body>
              <Body>Opening date: {row.openingDate}</Body>
              <Body>
                Opening balance: {row.openingBalanceMinor < 0 ? "-" : ""}
                {amountText(
                  Math.abs(row.openingBalanceMinor),
                  row.currency
                )}{" "}
                {row.currency}
              </Body>
              <Body>
                Currency, opening date and opening balance cannot be edited.
                Opening balance is a starting point, not income.
              </Body>
              {row.archivedAt && (
                <Body>
                  Archived: {row.archivedAt.slice(0, 10)}. Future entries cannot
                  select this account. Historical transactions and balances are
                  preserved.
                </Body>
              )}
              {state.detailError && (
                <StateNotice
                  kind="error"
                  title="Tracked balance unavailable"
                  message={state.detailError}
                />
              )}
              {state.detail?.id === row.id && (
                <Body>
                  Tracked balance as of {state.detail.asOf}:{" "}
                  {state.detail.balanceMinor < 0 ? "-" : ""}
                  {amountText(
                    Math.abs(state.detail.balanceMinor),
                    row.currency
                  )}{" "}
                  {row.currency}
                </Body>
              )}
            </View>
          )}
          {!row.archivedAt && (
            <>
              <Button
                label={`Rename ${row.name}`}
                disabled={disabled}
                onPress={() => state.edit(row)}
              />
              {row.currency === currency && (
                <Button
                  label={`Use ${row.name} as default`}
                  selected={defaultAccountId === row.id}
                  disabled={disabled}
                  onPress={() => void state.action("default", row)}
                />
              )}
              <Button
                label={`Archive ${row.name}`}
                disabled={disabled}
                onPress={() => state.setArchiving(row)}
              />
            </>
          )}
        </View>
      ))}
      {defaultAccountId && (
        <Button
          label="Clear default account"
          disabled={disabled}
          onPress={() => void state.action("default")}
        />
      )}
      {state.archiving && (
        <View style={styles.card}>
          <Text accessibilityRole="header" style={styles.heading}>
            Archive {state.archiving.name}?
          </Text>
          <Body>
            Future entries cannot select this account. Historical transactions
            and balances are preserved. If this is your default account, the
            default will be cleared.
          </Body>
          <Button
            label="Confirm archive account"
            disabled={disabled}
            onPress={() => void state.action("archive", state.archiving!)}
          />
          <Button
            label="Keep account"
            disabled={busy}
            onPress={() => state.setArchiving(null)}
          />
        </View>
      )}
      <View style={styles.card}>
        <Text accessibilityRole="header" style={styles.heading}>
          {state.editing ? "Rename account" : "Add account"} · Currency:{" "}
          {state.editing?.currency ?? currency}
        </Text>
        <Body>
          {state.editing
            ? "Change the name or descriptive type. The financial baseline stays the same."
            : "Currency is inherited from Settings. Opening balance is optional and defaults to zero; creating an account does not lock currency."}
        </Body>
        <Field
          label="Account name"
          value={state.name}
          editable={!disabled}
          autoCapitalize="words"
          onChangeText={state.setName}
        />
        {(["cash", "bank", "credit", "other"] as const).map((value) => (
          <Button
            key={value}
            label={`Account type ${value}`}
            selected={state.type === value}
            disabled={disabled}
            onPress={() => state.setType(value)}
          />
        ))}
        {!state.editing && (
          <>
            <Field
              label="Opening balance (optional)"
              value={state.opening}
              editable={!disabled}
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={state.setOpening}
            />
            <Body>
              Use a period for decimals and a minus sign for a negative balance,
              such as -12.34. Only the currency's supported decimal places are
              allowed.
            </Body>
            <Field
              label="Account opening date (YYYY-MM-DD)"
              value={state.date}
              editable={!disabled}
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={state.setDate}
            />
          </>
        )}
        <Button
          label={state.editing ? "Save account changes" : "Create account"}
          disabled={disabled}
          onPress={() => void state.action("save")}
        />
        {state.editing && (
          <Button
            label="Cancel account editing"
            disabled={busy}
            onPress={state.cancelEditing}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: theme.space.md },
  card: {
    gap: theme.space.md,
    padding: theme.space.md,
    borderWidth: 1,
    borderColor: theme.color.softBorder,
    borderRadius: theme.radius
  },
  heading: {
    color: theme.color.text,
    fontSize: theme.font.body,
    fontWeight: "700"
  }
});
