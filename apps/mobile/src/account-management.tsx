import { StyleSheet, Text, View } from "react-native";
import { Body, Button, Field, StateNotice } from "./ui";
import { amountText } from "./transaction-data";
import { theme } from "./theme";
import { HelpTooltip } from "./help-tooltip";
import { AccountTypeSelect } from "./account-type-select";
import { AccountCard } from "./account-card";
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
          {...(!busy && (!state.ready || (state.uncertain && !state.reviewed))
            ? { onRetry: () => void state.reload() }
            : {})}
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
      {state.uncertain && (
        <>
          <Body>
            The change may have succeeded. Review the refreshed accounts before
            another change.
          </Body>
          <Button
            label="I reviewed accounts; enable changes"
            disabled={busy || !state.ready || !state.reviewed}
            onPress={state.acknowledgeReview}
          />
        </>
      )}
      {state.rows.map((row) => (
        <AccountCard
          key={row.id}
          account={row}
          isDefault={defaultAccountId === row.id}
          expanded={state.selectedId === row.id}
          disabled={disabled}
          viewDisabled={state.selectedId !== row.id && (busy || !state.ready)}
          defaultEligible={row.currency === currency}
          onToggleDetails={() => state.toggleDetails(row)}
          onRename={() => state.edit(row)}
          onDefault={() => void state.action("default", row)}
          onArchive={() => state.setArchiving(row)}
        >
          {state.selectedId === row.id && (
            <View style={styles.section}>
              <Text accessibilityRole="header" style={styles.heading}>
                Account details: {row.name}
              </Text>
              <Body>Currency: {row.currency}</Body>
              {row.currency !== currency && (
                <Body>
                  Settings uses {currency}. This account retains {row.currency};
                  no money was converted. It cannot be the default for new
                  entries in {currency}.
                </Body>
              )}
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
                  onRetry={() => void state.viewDetails(row)}
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
        </AccountCard>
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
            default will be cleared. If no active accounts remain, transaction
            screens will require account setup before you can continue.
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
        <View style={styles.formHeading}>
          <Text accessibilityRole="header" style={styles.heading}>
            {state.editing ? "Rename account" : "Add account"}
          </Text>
          <HelpTooltip
            label={state.editing ? "Rename account help" : "Add account help"}
            description={
              state.editing
                ? "Change the name or account type. Currency, opening date and opening balance stay the same."
                : `Track your money in a named account, such as Chequing, Savings or Cash. No bank connection is created. Currency is ${currency}, inherited from your permanent choice.`
            }
          />
        </View>
        <Field
          label="Account name"
          value={state.name}
          editable={!disabled}
          autoCapitalize="words"
          onChangeText={state.setName}
        />
        <AccountTypeSelect
          value={state.type}
          onChange={state.setType}
          disabled={disabled}
        />
        {!state.editing && (
          <>
            <Field
              label="Opening balance (optional)"
              help="Your starting balance, not income. Leave blank for zero. Use a period for decimals and a minus sign for a negative balance, such as -12.34. Only your currency's supported decimal places are allowed. This balance cannot be edited after creation."
              value={state.opening}
              editable={!disabled}
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={state.setOpening}
            />
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
  formHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    zIndex: 3
  },
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
