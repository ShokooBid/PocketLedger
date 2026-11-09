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
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View
} from "react-native";
import Svg, { Path } from "react-native-svg";
import { useEntry } from "./entry-context";
import {
  keypadAmount,
  localDate,
  parseAddLink,
  type EntryField
} from "./entry-data";
import { calendarDate, currencyExponents } from "./transaction-data";
import { CategoryIcon } from "./category-icon";
import { AccountPicker, CategoryPicker } from "./finance-picker";
import { useAccounts } from "./transaction-context";
import { useCategories } from "./category-context";
import { Body, Button, Field, Screen, StateNotice } from "./ui";
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
  const [picker, setPicker] = useState<"account" | "category" | "date" | null>(
    null
  );
  const amountRef = useRef<ComponentRef<typeof TextInput>>(null),
    noteRef = useRef<ComponentRef<typeof TextInput>>(null);
  const accountRef = useRef<ComponentRef<typeof View>>(null),
    categoryRef = useRef<ComponentRef<typeof View>>(null),
    dateRef = useRef<ComponentRef<typeof View>>(null);
  const { reload } = entry;
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
      ["amount", "accountId", "categoryId", "date", "note"] as EntryField[]
    ).find((key) => entry.errors[key]);
    if (!first) return;
    const targets = {
      amount: amountRef,
      accountId: accountRef,
      categoryId: categoryRef,
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
    field: "accountId" | "categoryId" | "date",
    label: string,
    value: string,
    action: () => void
  ) {
    const ref =
      field === "accountId"
        ? accountRef
        : field === "categoryId"
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
                  ? "Account"
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
      title="New transaction"
      appearance="entry"
      onViewportLayout={setViewport}
    >
      <View
        accessibilityElementsHidden={picker !== null}
        importantForAccessibility={picker ? "no-hide-descendants" : "auto"}
        pointerEvents={picker ? "none" : "auto"}
        style={[
          styles.entry,
          { gap, paddingTop: compact ? 28 : spacious ? 72 : 64 }
        ]}
      >
        <View style={styles.segment}>
          {(["expense", "income"] as const).map((direction) => (
            <Pressable
              key={direction}
              accessibilityRole="button"
              accessibilityLabel={
                direction === "expense" ? "Expense" : "Income"
              }
              accessibilityState={{
                selected: entry.draft.direction === direction,
                disabled: entry.disabled
              }}
              disabled={entry.disabled}
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
                {direction === "expense" ? "Expense" : "Income"}
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
              entry.message.startsWith("Transaction saved.") ? 1 : undefined
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
            onSubmitEditing={() => void entry.save()}
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
            entry.draft.accountId
              ? `Account: ${entry.account?.name ?? "Unavailable"}`
              : "Choose account",
            entry.account?.name ?? "Choose account",
            () => setPicker("account")
          )}
          {selection(
            "categoryId",
            category ? `Category: ${selectedCategory}` : "Choose category",
            selectedCategory,
            () => setPicker("category")
          )}
        </View>
        {selection("date", "Choose transaction date", entry.draft.date, () =>
          setPicker("date")
        )}
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
        {!entry.activeAccounts.length && entry.ready && (
          <Button label="Add an account in Settings" onPress={settings} />
        )}
        {entry.uncertain && (
          <View style={styles.recovery}>
            <Body>
              The save may have succeeded. Values and the original request
              identity are frozen. Hard deletion removes replay protection.
            </Body>
            <Button
              label="Check saved transactions"
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
                entry.busy ? "Saving transaction…" : "Save transaction"
              }
              accessibilityHint="Confirm and save the transaction"
              accessibilityState={{
                disabled: entry.disabled,
                busy: entry.busy
              }}
              disabled={entry.disabled}
              onPress={() => void entry.save()}
              style={({ pressed }) => [
                styles.confirmKey,
                (pressed || entry.disabled) && styles.keyDisabled
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
          onClose={() => setPicker(null)}
          onSelect={(id, rows) => {
            entry.selectAccount(id, rows);
            setPicker(null);
          }}
          onSettings={settings}
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
      {picker === "date" && (
        <DatePicker
          value={entry.draft.date}
          onClose={() => setPicker(null)}
          onSelect={(next) => {
            entry.change({ date: next });
            setPicker(null);
          }}
        />
      )}
    </Screen>
  );
}

// Calendar uses local date strings; no UTC conversion of an accounting date.
function DatePicker({
  value,
  onClose,
  onSelect
}: {
  value: string;
  onClose: () => void;
  onSelect: (date: string) => void;
}) {
  const initial = calendarDate.safeParse(value).success ? value : localDate();
  const [month, setMonth] = useState(initial.slice(0, 7)),
    [typed, setTyped] = useState(value);
  const [year, number] = month.split("-").map(Number) as [number, number];
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days =
    number === 2 ? (leap ? 29 : 28) : [4, 6, 9, 11].includes(number) ? 30 : 31;
  function move(delta: number) {
    const index = year * 12 + number - 1 + delta;
    if (index < 12 || index >= 120000) return;
    setMonth(
      `${String(Math.floor(index / 12)).padStart(4, "0")}-${String((index % 12) + 1).padStart(2, "0")}`
    );
  }
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <Screen title="Choose transaction date">
        <Button label="Cancel date selection" onPress={onClose} />
        <View style={[styles.keyRow, styles.calendarNavigation]}>
          <Button
            label="Previous month"
            disabled={month === "0001-01"}
            onPress={() => move(-1)}
          />
          <Text accessibilityRole="header" style={styles.selectionValue}>
            {month}
          </Text>
          <Button
            label="Next month"
            disabled={month === "9999-12"}
            onPress={() => move(1)}
          />
        </View>
        <View style={styles.calendar}>
          {Array.from({ length: days }, (_, i) => {
            const day = `${month}-${String(i + 1).padStart(2, "0")}`;
            return (
              <Pressable
                key={day}
                accessibilityRole="button"
                accessibilityLabel={`Choose ${day}`}
                accessibilityState={{ selected: day === value }}
                onPress={() => onSelect(day)}
                style={[styles.day, day === value && styles.selected]}
              >
                <Text
                  style={
                    day === value ? styles.selectedText : styles.selectionValue
                  }
                >
                  {i + 1}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Button label="Use today" onPress={() => onSelect(localDate())} />
        <Field
          label="Transaction date (YYYY-MM-DD)"
          value={typed}
          onChangeText={setTyped}
        />
        <Button
          label="Use entered date"
          disabled={!calendarDate.safeParse(typed).success}
          onPress={() => onSelect(typed)}
        />
      </Screen>
    </Modal>
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
  recovery: { gap: 8 },
  calendar: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  calendarNavigation: { flexWrap: "wrap", justifyContent: "space-between" },
  day: {
    width: "13%",
    minWidth: 48,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    backgroundColor: theme.color.primarySoft
  }
});
