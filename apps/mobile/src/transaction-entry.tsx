import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentRef
} from "react";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import {
  AccessibilityInfo,
  ActivityIndicator,
  AppState,
  BackHandler,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View
} from "react-native";
import Svg, { Path } from "react-native-svg";
import { useEntry } from "./entry-context";
import { keypadAmount, parseAddLink, type EntryField } from "./entry-data";
import { currencyExponents } from "./transaction-data";
import { CategoryIcon } from "./category-icon";
import { AccountPicker, CategoryPicker } from "./finance-picker";
import { useAccounts } from "./transaction-context";
import { useCategories } from "./category-context";
import { Body, Button, Screen, StateNotice } from "./ui";
import { SingleDateField } from "./date-picker";
import { theme } from "./theme";

export function TransactionEntry() {
  const entry = useEntry(),
    router = useRouter(),
    accountSource = useAccounts(),
    categorySource = useCategories();
  const { date, currency } = useLocalSearchParams();
  const handledLink = useRef<string | null>(null);
  const [invalidLink, setInvalidLink] = useState(false);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const { fontScale } = useWindowDimensions();
  // Measure the actual scroll viewport: tabs and safe areas have already taken
  // their space. Flexible amount space absorbs the remaining height naturally.
  const compact = viewport.height < 580 || fontScale > 1.3;
  const spacious = viewport.height >= 680 && !compact;
  const gap = compact ? 6 : spacious ? 10 : 8;
  const keyHeight = Math.max(
    spacious ? 52 : 48,
    Math.ceil(28 * fontScale + 12)
  );
  const [picker, setPicker] = useState<
    "account" | "category" | "toAccount" | null
  >(null);
  const amountRef = useRef<ComponentRef<typeof TextInput>>(null),
    noteRef = useRef<ComponentRef<typeof TextInput>>(null);
  const accountRef = useRef<ComponentRef<typeof View>>(null),
    categoryRef = useRef<ComponentRef<typeof View>>(null),
    dateRef = useRef<ComponentRef<typeof View>>(null);
  const { reload } = entry;
  useEffect(() => {
    if (!entry.saved) return;
    const saved = entry.saved;
    entry.consumeSaved();
    router.navigate({
      pathname: "/transactions",
      params: { focusId: saved.id, focusKind: saved.kind }
    });
  }, [entry.saved, router]);
  useFocusEffect(
    useCallback(() => {
      if (entry.financeReady) void reload();
    }, [reload, entry.financeReady])
  );
  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener(
        "hardwareBackPress",
        () => {
          // Moving among tabs keeps the draft. Only exiting the root loses it.
          if (
            router.canGoBack() ||
            (!entry.dirty && !entry.busy && !entry.uncertain)
          )
            return false;
          entry.requestDiscard(() => BackHandler.exitApp());
          return true;
        }
      );
      return () => subscription.remove();
    }, [entry, router])
  );
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active" && entry.financeReady) void reload();
    });
    return () => subscription.remove();
  }, [reload, entry.financeReady]);
  useEffect(() => {
    if (date === undefined && currency === undefined) {
      handledLink.current = null;
      return;
    }
    if (!entry.financeReady || !entry.ready) return;
    const identity = JSON.stringify([date, currency]);
    if (handledLink.current === identity) return;
    handledLink.current = identity;
    const link = parseAddLink(date, currency);
    if (link) entry.applyLink(link);
    else setInvalidLink(true);
    // Remove consumed parameters so revisiting Add does not replay an old link.
    router.setParams({ date: undefined, currency: undefined });
  }, [date, currency, entry, router]);
  useEffect(() => {
    const first = (
      [
        "amount",
        "accountId",
        "toAccountId",
        "categoryId",
        "date",
        "note"
      ] as EntryField[]
    ).find((key) => entry.errors[key]);
    if (!first) return;
    const targets = {
      amount: amountRef,
      accountId: accountRef,
      categoryId: categoryRef,
      toAccountId: categoryRef,
      date: dateRef,
      note: noteRef
    };
    targets[first].current?.focus();
    AccessibilityInfo.announceForAccessibility(entry.errors[first]!);
  }, [entry.errors]);
  const settings = () => {
    setPicker(null);
    router.push({
      pathname: "/settings",
      params: { returnTo: "transaction-draft" }
    });
  };
  const currencyLabel = entry.account?.currency ?? entry.draft.currency;
  const transfer = entry.draft.direction === "transfer";
  const destination = entry.accounts.find(
    (row) => row.id === entry.draft.toAccountId
  );
  const saveDisabled =
    entry.disabled || (transfer && entry.activeAccounts.length < 2);
  const category = entry.categories.find(
    (row) => row.id === entry.draft.categoryId
  );
  const selectedCategory = category?.name ?? "Choose category";
  function error(field: EntryField) {
    return entry.errors[field] ? (
      <Text accessibilityRole="alert" style={styles.error}>
        {entry.errors[field]}
      </Text>
    ) : null;
  }
  function selection(
    field: "accountId" | "categoryId" | "toAccountId" | "date",
    label: string,
    value: string,
    action: () => void,
    expanded?: boolean
  ) {
    const ref =
      field === "accountId"
        ? accountRef
        : field === "categoryId" || field === "toAccountId"
          ? categoryRef
          : dateRef;
    return (
      <View
        style={[styles.selectionWrap, field !== "date" && styles.pairSelection]}
      >
        <Pressable
          ref={ref}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityHint={value}
          accessibilityState={{
            selected: !!entry.draft[field],
            ...(expanded === undefined ? {} : { expanded }),
            disabled: entry.disabled
          }}
          disabled={entry.disabled}
          onPress={action}
          style={[styles.selection, field === "date" && styles.dateSelection]}
        >
          {field === "categoryId" && (
            <CategoryIcon iconKey={category?.iconKey ?? undefined} size={28} />
          )}
          <View style={styles.selectionText}>
            {field !== "date" && (
              <Text style={styles.caption}>
                {field === "accountId"
                  ? transfer
                    ? "From Account"
                    : "Account"
                  : field === "toAccountId"
                    ? "To Account"
                    : field === "categoryId"
                      ? "Category"
                      : "Date"}
              </Text>
            )}
            <Text
              numberOfLines={1}
              ellipsizeMode="tail"
              style={styles.selectionValue}
            >
              {value}
            </Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
        {error(field)}
      </View>
    );
  }
  return (
    <Screen
      title={
        entry.editingTransfer
          ? "Edit transfer"
          : entry.editingTransaction
            ? "Edit transaction"
            : "New transaction"
      }
      appearance="entry"
      onViewportLayout={setViewport}
    >
      <View
        accessibilityElementsHidden={picker !== null || !!entry.confirmation}
        importantForAccessibility={
          picker || entry.confirmation ? "no-hide-descendants" : "auto"
        }
        pointerEvents={picker || entry.confirmation ? "none" : "auto"}
        style={[
          styles.entry,
          { gap, paddingTop: compact ? 28 : spacious ? 72 : 64 }
        ]}
      >
        <View style={styles.segment}>
          {(["expense", "income", "transfer"] as const).map((direction) => (
            <Pressable
              key={direction}
              accessibilityRole="button"
              accessibilityLabel={
                direction === "expense"
                  ? "Expense"
                  : direction === "income"
                    ? "Income"
                    : "Transfer"
              }
              accessibilityState={{
                selected: entry.draft.direction === direction,
                disabled:
                  entry.modeDisabled ||
                  !!entry.editingTransfer ||
                  !!entry.editingTransaction
              }}
              disabled={
                entry.modeDisabled ||
                !!entry.editingTransfer ||
                !!entry.editingTransaction
              }
              onPress={() => entry.change({ direction })}
              style={[
                styles.segmentButton,
                entry.draft.direction === direction && styles.selected
              ]}
            >
              <Text
                style={[
                  styles.segmentText,
                  entry.draft.direction === direction && styles.selectedText
                ]}
              >
                {direction === "expense"
                  ? "Expense"
                  : direction === "income"
                    ? "Income"
                    : "Transfer"}
              </Text>
            </Pressable>
          ))}
        </View>
        {invalidLink && (
          <StateNotice
            kind="error"
            title="Invalid add transaction request"
            message="The link was not applied. Your draft is unchanged; continue here or return to History."
            onRetry={() => setInvalidLink(false)}
          />
        )}
        {entry.loading && (
          <Text
            accessibilityLiveRegion="polite"
            accessibilityState={{ busy: true }}
            style={styles.caption}
          >
            Refreshing entry choices…
          </Text>
        )}
        {entry.readError && (
          <StateNotice
            kind="error"
            title="Entry needs attention"
            message={entry.readError}
            onRetry={() => void entry.reload()}
          />
        )}
        {entry.message && (
          <Text
            accessibilityLiveRegion="polite"
            numberOfLines={
              /^(Transaction|Transfer) saved\./.test(entry.message)
                ? 1
                : undefined
            }
            ellipsizeMode="tail"
            style={styles.message}
          >
            {entry.message}
          </Text>
        )}
        <View
          style={[
            styles.amountRow,
            { minHeight: compact ? 56 : spacious ? 104 : 80 }
          ]}
        >
          <Text
            accessibilityLabel={`Account currency: ${currencyLabel}`}
            style={styles.currency}
          >
            {currencyLabel}
          </Text>
          <TextInput
            ref={amountRef}
            accessibilityLabel="Amount"
            accessibilityHint="Use the number keys below, or a hardware keyboard. Confirm saves the transaction."
            value={entry.draft.amount}
            placeholder={
              currencyExponents[currencyLabel]
                ? `0.${"0".repeat(currencyExponents[currencyLabel])}`
                : "0"
            }
            placeholderTextColor={theme.color.text}
            showSoftInputOnFocus={false}
            keyboardType="decimal-pad"
            editable={!entry.disabled}
            onChangeText={(next) => {
              // Pasting/hardware typing obeys the same rules as the custom keys.
              let accepted = "";
              for (const key of next)
                accepted = keypadAmount(accepted, key, currencyLabel);
              if (accepted === next || (next === "0" && accepted === "0"))
                entry.change({ amount: next });
            }}
            onSubmitEditing={() => {
              if (!saveDisabled) void entry.save();
            }}
            returnKeyType="done"
            style={[
              styles.amount,
              { fontSize: compact ? 44 : spacious ? 64 : 56 }
            ]}
          />
        </View>
        {error("amount")}
        <View style={styles.pair}>
          {selection(
            "accountId",
            transfer
              ? entry.draft.accountId
                ? `From Account: ${entry.account?.name ?? "Unavailable"}`
                : "Choose From Account"
              : entry.draft.accountId
                ? `Account: ${entry.account?.name ?? "Unavailable"}`
                : "Choose account",
            entry.account?.name ??
              (transfer ? "Choose From Account" : "Choose account"),
            () => setPicker("account")
          )}
          {transfer
            ? selection(
                "toAccountId",
                destination
                  ? `To Account: ${destination.name}`
                  : "Choose To Account",
                destination?.name ?? "Choose To Account",
                () => setPicker("toAccount")
              )
            : selection(
                "categoryId",
                category ? `Category: ${selectedCategory}` : "Choose category",
                selectedCategory,
                () => setPicker("category")
              )}
        </View>
        <SingleDateField
          value={entry.draft.date}
          disabled={entry.disabled}
          onChange={(date) => entry.change({ date })}
          renderTrigger={(toggle, expanded) =>
            selection(
              "date",
              "Choose transaction date",
              entry.draft.date,
              toggle,
              expanded
            )
          }
        />
        <View style={styles.note}>
          <TextInput
            ref={noteRef}
            accessibilityLabel="Note (optional)"
            value={entry.draft.note}
            placeholder="Description (optional)"
            multiline={false}
            numberOfLines={1}
            placeholderTextColor={theme.color.muted}
            editable={!entry.disabled}
            maxLength={2000}
            onChangeText={(note) => entry.change({ note })}
            style={styles.noteInput}
          />
        </View>
        {error("note")}
        {entry.ready &&
          (!entry.activeAccounts.length ||
            (transfer && entry.activeAccounts.length < 2)) && (
            <Body>
              Transfers need two active accounts in {entry.draft.currency}.
            </Body>
          )}
        {entry.ready &&
          (!entry.activeAccounts.length ||
            (transfer && entry.activeAccounts.length < 2)) && (
            <Button label="Add an account in Settings" onPress={settings} />
          )}
        {(entry.editingTransfer || entry.editingTransaction) && (
          <Button
            label={
              transfer
                ? "Cancel transfer editing"
                : "Cancel transaction editing"
            }
            disabled={entry.busy || entry.uncertain}
            onPress={() =>
              entry.cancelEditing(() => router.navigate("/transactions"))
            }
          />
        )}
        {entry.uncertain && (
          <View style={styles.recovery}>
            <Body>
              The save may have succeeded. Values and the original request
              identity are frozen. Hard deletion removes replay protection.
            </Body>
            <Button
              label={
                transfer ? "Check saved transfers" : "Check saved transactions"
              }
              disabled={entry.busy}
              onPress={() => void entry.review()}
            />
            <Button
              label="Retry original save"
              disabled={
                entry.busy ||
                !entry.reviewed ||
                !entry.ready ||
                !entry.financeReady
              }
              onPress={() => void entry.save(true)}
            />
          </View>
        )}
        <View style={styles.keypad} accessibilityLabel="Amount keypad">
          <View style={styles.numberPad}>
            {[
              ["1", "2", "3"],
              ["4", "5", "6"],
              ["7", "8", "9"],
              [".", "0"]
            ].map((row, index) => (
              <View key={index} style={styles.keyRow}>
                {row.map((key) => (
                  <Pressable
                    key={key}
                    accessibilityRole="button"
                    accessibilityLabel={
                      key === "." ? "Decimal point" : `Digit ${key}`
                    }
                    accessibilityState={{
                      disabled:
                        entry.disabled ||
                        (key === "." && !currencyExponents[currencyLabel])
                    }}
                    disabled={
                      entry.disabled ||
                      (key === "." && !currencyExponents[currencyLabel])
                    }
                    onPress={() =>
                      entry.change({
                        amount: keypadAmount(
                          entry.draft.amount,
                          key,
                          currencyLabel
                        )
                      })
                    }
                    style={({ pressed }) => [
                      styles.key,
                      { minHeight: keyHeight },
                      index === 3 && key === "0" && styles.zeroKey,
                      pressed && styles.keyPressed,
                      key === "." &&
                        !currencyExponents[currencyLabel] &&
                        styles.keyDisabled
                    ]}
                  >
                    <Text style={styles.keyText}>{key}</Text>
                  </Pressable>
                ))}
              </View>
            ))}
          </View>
          <View style={styles.keyActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Delete last digit"
              accessibilityState={{ disabled: entry.disabled }}
              disabled={entry.disabled}
              onPress={() =>
                entry.change({
                  amount: keypadAmount(
                    entry.draft.amount,
                    "backspace",
                    currencyLabel
                  )
                })
              }
              style={({ pressed }) => [
                styles.key,
                styles.deleteKey,
                { height: keyHeight },
                pressed && styles.keyPressed
              ]}
            >
              <Svg
                width={26}
                height={26}
                viewBox="0 0 24 24"
                accessible={false}
              >
                <Path
                  d="M9 5H21V19H9L2 12Z M12 9L18 15 M18 9L12 15"
                  fill="none"
                  stroke={theme.color.text}
                  strokeWidth={1.8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </Svg>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                entry.busy
                  ? "Saving transaction…"
                  : transfer
                    ? "Review transfer"
                    : entry.editingTransaction
                      ? "Update transaction"
                      : "Save transaction"
              }
              accessibilityHint={
                transfer
                  ? "Review both accounts and the amount before confirming"
                  : "Confirm and save the transaction"
              }
              accessibilityState={{
                disabled: saveDisabled,
                busy: entry.busy
              }}
              disabled={saveDisabled}
              onPress={() => void entry.save()}
              style={({ pressed }) => [
                styles.confirmKey,
                (pressed || saveDisabled) && styles.keyDisabled
              ]}
            >
              {entry.busy ? (
                <ActivityIndicator color={theme.color.onPrimary} />
              ) : (
                <Svg
                  width={32}
                  height={32}
                  viewBox="0 0 24 24"
                  accessible={false}
                >
                  <Path
                    d="M5 12L10 17L20 7"
                    fill="none"
                    stroke={theme.color.onPrimary}
                    strokeWidth={2.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </Svg>
              )}
            </Pressable>
          </View>
        </View>
      </View>
      {picker === "account" && (
        <AccountPicker
          source={accountSource}
          currency={entry.draft.currency}
          selectedId={entry.draft.accountId}
          title={transfer ? "Choose From Account" : "Choose account"}
          {...(transfer ? { excludeId: entry.draft.toAccountId } : {})}
          onClose={() => setPicker(null)}
          onSelect={(id, rows) => {
            entry.selectAccount(id, rows);
            setPicker(null);
          }}
          onSettings={settings}
        />
      )}
      {picker === "toAccount" && (
        <AccountPicker
          source={accountSource}
          currency={currencyLabel}
          selectedId={entry.draft.toAccountId}
          title="Choose To Account"
          excludeId={entry.draft.accountId}
          onClear={() => {
            entry.change({ toAccountId: "" });
            setPicker(null);
          }}
          onClose={() => setPicker(null)}
          onSettings={settings}
          onSelect={(id, rows) => {
            entry.selectAccount(id, rows, "to");
            setPicker(null);
          }}
        />
      )}
      {picker === "category" && (
        <CategoryPicker
          source={categorySource}
          selectedId={entry.draft.categoryId}
          onClose={() => setPicker(null)}
          onSelect={(id, rows) => {
            entry.selectCategory(id, rows);
            setPicker(null);
          }}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  entry: { flexGrow: 1, paddingBottom: 8 },
  segment: {
    flexDirection: "row",
    padding: 0,
    borderRadius: 18,
    backgroundColor: theme.color.primarySoft
  },
  segmentButton: {
    flex: 1,
    minHeight: 48,
    padding: 8,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center"
  },
  selected: { backgroundColor: theme.color.primary },
  selectedText: { color: theme.color.onPrimary, fontWeight: "700" },
  segmentText: { fontSize: 16, color: theme.color.text, fontWeight: "600" },
  amountRow: {
    flexGrow: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 56
  },
  currency: { fontSize: 16, fontWeight: "600", color: theme.color.text },
  amount: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
    fontWeight: "700",
    color: theme.color.text,
    textAlign: "center",
    padding: 0
  },
  pair: { flexDirection: "row", gap: 8 },
  selectionWrap: { gap: 4, minWidth: 0 },
  pairSelection: { flex: 1 },
  selection: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: theme.color.primarySoft,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 14,
    minHeight: 48,
    borderWidth: 1,
    borderColor: theme.color.softBorder
  },
  dateSelection: { minHeight: 48, paddingVertical: 4 },
  selectionText: { flex: 1, minWidth: 0 },
  caption: { color: theme.color.muted, fontSize: 12 },
  selectionValue: { fontSize: 15, color: theme.color.text, fontWeight: "500" },
  chevron: { color: theme.color.primary, fontSize: 26 },
  note: {
    borderWidth: 1,
    borderColor: theme.color.softBorder,
    borderRadius: 14,
    paddingHorizontal: 12
  },
  noteInput: {
    color: theme.color.text,
    fontSize: 15,
    minHeight: 48,
    paddingVertical: 4
  },
  keypad: {
    flexDirection: "row",
    gap: 4,
    padding: 4,
    borderRadius: 18,
    backgroundColor: theme.color.primarySoft
  },
  numberPad: { flex: 3, gap: 4 },
  keyActions: { flex: 1, gap: 4 },
  keyRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  key: {
    flex: 1,
    minHeight: 48,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: theme.color.surface,
    alignItems: "center",
    justifyContent: "center"
  },
  keyPressed: { backgroundColor: theme.color.softBorder },
  zeroKey: { flex: 2 },
  deleteKey: { flex: 0, height: 48 },
  confirmKey: {
    flex: 1,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    backgroundColor: theme.color.primary
  },
  keyDisabled: { opacity: 0.45 },
  keyText: {
    color: theme.color.text,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "500"
  },
  error: { color: theme.color.error, fontSize: 16 },
  message: { color: theme.color.primary, fontSize: 14, lineHeight: 18 },
  recovery: { gap: 8 }
});
