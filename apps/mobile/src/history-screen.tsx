import { useState } from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle
} from "react-native";
import Svg, { Path } from "react-native-svg";
import { Body, Button, Field, Screen, StateNotice } from "./ui";
import { theme } from "./theme";
import { CategoryIcon } from "./category-icon";
import { categoryPath, orderedCategories } from "./category-hierarchy";
import {
  adjacentMonth,
  currentMonth,
  monthLabel,
  monthRange,
  monthSchema
} from "./dashboard-data";
import { calendarDate } from "./transaction-data";
import {
  historyDateLabel,
  historyKey,
  historyRecordText,
  signedMoney,
  type HistoryRow
} from "./history-data";
import { useHistory, type HistoryProps } from "./use-history";

export function HistoryScreen(
  props: HistoryProps & {
    onSelect: (row: HistoryRow) => void;
    writeBlocked?: boolean;
  }
) {
  const state = useHistory(props);
  const { fontScale } = useWindowDimensions();
  const { filter, setFilter, page, busy } = state;
  const [picker, setPicker] = useState<
    "account" | "category" | "type" | "from" | "to" | "month" | null
  >(null);
  const [search, setSearch] = useState("");
  const [monthInput, setMonthInput] = useState(currentMonth());
  const selectedMonth = filter.from?.slice(0, 7) ?? monthInput;
  const exactMonth =
    filter.from &&
    filter.to &&
    monthSchema.safeParse(selectedMonth).success &&
    filter.from === monthRange(selectedMonth).from &&
    filter.to === monthRange(selectedMonth).to;
  const anchor = monthSchema.safeParse(selectedMonth).success
    ? selectedMonth
    : currentMonth();
  const previous = adjacentMonth(anchor, -1),
    next = adjacentMonth(anchor, 1);
  const category = state.categoryChoices.find(
    (row) => row.id === filter.categoryId
  );
  const account = state.accountChoices.find(
    (row) => row.id === filter.accountId
  );
  const dates = [...new Set(page?.items.map((row) => row.date) ?? [])];
  const disabled = busy || !props.ready || !props.active;
  function open(value: typeof picker) {
    setSearch("");
    setPicker(value);
  }
  function clearCategory() {
    setFilter((current) => {
      const result = { ...current };
      delete result.categoryId;
      delete result.includeSubcategories;
      return result;
    });
    setPicker(null);
  }
  return (
    <>
      <View
        accessibilityElementsHidden={picker !== null}
        importantForAccessibility={picker ? "no-hide-descendants" : "auto"}
        style={styles.section}
      >
        <View style={styles.monthBar}>
          <HistoryPill
            label="Previous month"
            text="‹"
            disabled={disabled || !previous}
            onPress={() => previous && state.selectMonth(previous)}
            style={styles.arrow}
          />
          <HistoryPill
            label={exactMonth ? monthLabel(anchor) : "Choose month"}
            text={`${monthLabel(anchor).slice(0, 3)} ${anchor.slice(0, 4)} ⌄`}
            disabled={disabled}
            onPress={() => {
              setMonthInput(anchor);
              open("month");
            }}
            style={styles.monthChoice}
          />
          <HistoryPill
            label="Choose month calendar"
            text="▦"
            disabled={disabled}
            onPress={() => {
              setMonthInput(anchor);
              open("month");
            }}
            style={styles.calendarShortcut}
          />
          <HistoryPill
            label="Next month"
            text="›"
            disabled={disabled || !next}
            onPress={() => next && state.selectMonth(next)}
            style={styles.arrow}
          />
        </View>
        <View style={[styles.dateBar, fontScale > 1.3 && styles.dateBarWrap]}>
          <HistoryPill
            label={`From: ${filter.from ?? "Any date"}`}
            text={exactMonth ? "From date" : (filter.from ?? "From date")}
            disabled={disabled}
            onPress={() => open("from")}
            style={styles.dateChoice}
          />
          <Text style={styles.dateDivider}>–</Text>
          <HistoryPill
            label={`To: ${filter.to ?? "Any date"}`}
            text={exactMonth ? "To date" : (filter.to ?? "To date")}
            disabled={disabled}
            onPress={() => open("to")}
            style={styles.dateChoice}
          />
          <HistoryPill
            label="Apply filters"
            text="Apply"
            disabled={disabled}
            onPress={state.apply}
            primary
            style={styles.apply}
          />
        </View>
        <View
          style={[styles.filterBar, fontScale > 1.3 && styles.filterBarWrap]}
        >
          <HistoryPill
            label={`Account: ${account?.name ?? (filter.accountId ? "Unavailable" : "All")}${account?.archivedAt ? " (archived)" : ""}`}
            text={`⌂  ${account?.name ?? "Account"}  ⌄`}
            disabled={disabled}
            onPress={() => open("account")}
            style={[
              styles.filterChip,
              fontScale > 1.3 && styles.filterChipWide
            ]}
          />
          <HistoryPill
            label={`Type: ${filter.type ?? "All"}`}
            text={`⇄  ${filter.type ?? "Type"}  ⌄`}
            disabled={disabled}
            onPress={() => open("type")}
            style={[
              styles.filterChip,
              fontScale > 1.3 && styles.filterChipWide
            ]}
          />
          <HistoryPill
            label={`Category: ${category ? categoryPath(category, state.categoryChoices) : filter.categoryId ? "Unavailable" : "All"}`}
            text={`◇  ${category?.name ?? "Category"}  ⌄`}
            disabled={disabled}
            onPress={() => open("category")}
            style={[
              styles.filterChip,
              fontScale > 1.3 && styles.filterChipWide
            ]}
          />
        </View>
        {category && !category.parentId && (
          <HistoryPill
            label={
              filter.includeSubcategories
                ? "Category scope: Parent and subcategories"
                : "Category scope: Exact category"
            }
            text={
              filter.includeSubcategories
                ? "Include subcategories"
                : "Exact category"
            }
            selected={!!filter.includeSubcategories}
            disabled={disabled}
            style={styles.scopeChip}
            onPress={() =>
              setFilter({
                ...filter,
                includeSubcategories: !filter.includeSubcategories
              })
            }
          />
        )}
        {filter.categoryId && (
          <Body>
            Transfers have no category and are excluded when a category filter
            is applied.
          </Body>
        )}
        <View style={styles.actions}>
          <HistoryPill
            label="Clear filters"
            text="Clear"
            disabled={disabled}
            onPress={state.clear}
            style={styles.textAction}
          />
          <HistoryPill
            label="Refresh history"
            text="Refresh"
            disabled={disabled}
            onPress={state.refresh}
            style={styles.textAction}
          />
        </View>
        {page?.adjustments.length ? (
          <Text accessibilityLiveRegion="polite" style={styles.notice}>
            {page.adjustments.join(" ")}
          </Text>
        ) : null}
        {busy && (
          <StateNotice
            kind="loading"
            title="Loading history"
            message="Existing rows stay visible while History refreshes."
          />
        )}
        {state.error && (
          <StateNotice
            kind="error"
            title="History needs attention"
            message={state.error}
            {...(!busy ? { onRetry: state.refresh } : {})}
          />
        )}
        {state.stale && page && (
          <Body>
            Previously loaded history and totals may be out of date. Refresh
            before continuing pagination.
          </Body>
        )}
        {page?.previousCursor && (
          <Button
            label="Load newer transactions"
            disabled={disabled || state.stale}
            onPress={() => state.more("newer")}
          />
        )}
        {page && !page.items.length && !busy && !state.error && (
          <StateNotice
            kind="empty"
            title="No transactions match"
            message="Adjust the date, account, type or category filters, or clear them to see all history."
          />
        )}
        {dates.map((date) => (
          <View key={date} style={styles.group}>
            <View style={styles.groupHeader}>
              <Text accessibilityRole="header" style={styles.date}>
                {historyDateLabel(date)}
              </Text>
              <View style={styles.daySummary}>
                {page?.days
                  .filter((day) => day.date === date)
                  .map((day) => (
                    <Text
                      key={day.currency}
                      style={[
                        styles.dayTotal,
                        day.netMinor < 0 && styles.expense,
                        day.netMinor > 0 && styles.income
                      ]}
                    >
                      {day.count}{" "}
                      {day.count === 1 ? "transaction" : "transactions"} · Net{" "}
                      {signedMoney(day.netMinor, day.currency)}
                    </Text>
                  ))}
              </View>
            </View>
            {page?.items
              .filter((row) => row.date === date)
              .map((row) => (
                <HistoryRecord
                  key={`${row.kind}_${row.id}`}
                  row={row}
                  highlighted={page.focusedKey === historyKey(row)}
                  {...(page.applied.accountId
                    ? { statementAccountId: page.applied.accountId }
                    : {})}
                  disabled={disabled || !!props.writeBlocked}
                  onPress={() => props.onSelect(row)}
                />
              ))}
          </View>
        ))}
        {page?.nextCursor ? (
          <Button
            label="Load older transactions"
            disabled={disabled || state.stale}
            onPress={() => state.more("older")}
          />
        ) : page?.items.length && !busy ? (
          <Body>End of matching history.</Body>
        ) : null}
      </View>
      {(picker === "account" ||
        picker === "category" ||
        picker === "type" ||
        picker === "month") && (
        <Modal
          visible
          animationType="slide"
          onRequestClose={() => setPicker(null)}
        >
          <Screen title={`Choose ${picker}`} showUserMenu={false}>
            <Button
              label="Cancel filter selection"
              onPress={() => setPicker(null)}
            />
            {(picker === "account" || picker === "category") && (
              <Field
                label={`Search ${picker} choices`}
                value={search}
                onChangeText={setSearch}
              />
            )}
            {picker === "account" && (
              <>
                <Button
                  label="All accounts"
                  selected={!filter.accountId}
                  onPress={() => {
                    setFilter((current) => {
                      const result = { ...current };
                      delete result.accountId;
                      return result;
                    });
                    setPicker(null);
                  }}
                />
                {state.accountChoices
                  .filter((row) =>
                    row.name
                      .toLocaleLowerCase()
                      .includes(search.toLocaleLowerCase())
                  )
                  .map((row) => (
                    <Button
                      key={row.id}
                      label={`${row.name} · ${row.currency}${row.archivedAt ? " (archived)" : ""}`}
                      selected={row.id === filter.accountId}
                      onPress={() => {
                        setFilter({ ...filter, accountId: row.id });
                        setPicker(null);
                      }}
                    />
                  ))}
              </>
            )}
            {picker === "category" && (
              <>
                <Button
                  label="All categories"
                  selected={!filter.categoryId}
                  onPress={clearCategory}
                />
                {orderedCategories(state.categoryChoices)
                  .filter((row) =>
                    categoryPath(row, state.categoryChoices)
                      .toLocaleLowerCase()
                      .includes(search.toLocaleLowerCase())
                  )
                  .map((row) => (
                    <Button
                      key={row.id}
                      leading={<CategoryIcon iconKey={row.iconKey} />}
                      label={`${categoryPath(row, state.categoryChoices)}${row.archivedAt ? " (archived)" : ""}`}
                      selected={row.id === filter.categoryId}
                      onPress={() => {
                        setFilter({
                          ...filter,
                          categoryId: row.id,
                          includeSubcategories: false
                        });
                        setPicker(null);
                      }}
                    />
                  ))}
              </>
            )}
            {picker === "type" &&
              ([undefined, "income", "expense", "transfer"] as const).map(
                (type) => (
                  <Button
                    key={type ?? "all"}
                    label={type ?? "All types"}
                    selected={filter.type === type}
                    onPress={() => {
                      setFilter((current) => {
                        const result = { ...current };
                        if (type) result.type = type;
                        else delete result.type;
                        return result;
                      });
                      setPicker(null);
                    }}
                  />
                )
              )}
            {picker === "month" && (
              <>
                <Field
                  label="Month (YYYY-MM)"
                  value={monthInput}
                  onChangeText={setMonthInput}
                />
                <Button
                  label="Show selected month"
                  disabled={!monthSchema.safeParse(monthInput).success}
                  onPress={() => {
                    state.selectMonth(monthInput);
                    setPicker(null);
                  }}
                />
              </>
            )}
          </Screen>
        </Modal>
      )}
      {(picker === "from" || picker === "to") && (
        <HistoryCalendar
          title={picker === "from" ? "From date" : "To date"}
          value={filter[picker] ?? monthRange(currentMonth()).from}
          onClose={() => setPicker(null)}
          onSelect={(date) => {
            setFilter({ ...filter, [picker]: date });
            setPicker(null);
          }}
        />
      )}
    </>
  );
}
function HistoryPill({
  label,
  text,
  disabled,
  onPress,
  style,
  primary = false,
  selected = false
}: {
  label: string;
  text: string;
  disabled: boolean;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
  primary?: boolean;
  selected?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.pill,
        style,
        primary && styles.primaryPill,
        (pressed || disabled) && styles.pressed
      ]}
    >
      <Text
        numberOfLines={1}
        style={[styles.pillText, primary && styles.primaryPillText]}
      >
        {text}
      </Text>
    </Pressable>
  );
}
function HistoryRecord({
  row,
  highlighted,
  disabled,
  onPress,
  statementAccountId
}: {
  row: HistoryRow;
  highlighted: boolean;
  disabled: boolean;
  onPress: () => void;
  statementAccountId?: string;
}) {
  const transfer = row.kind === "transfer";
  const { category, description, accounts, amount, typeLabel } =
    historyRecordText(row, statementAccountId);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${highlighted ? "Saved record. " : ""}${description}. ${typeLabel}. ${accounts}. ${category ?? ""}. ${amount}. ${historyDateLabel(row.date)}`}
      accessibilityHint="Open this record in the editor"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        highlighted && styles.highlighted,
        pressed && styles.pressed
      ]}
    >
      {transfer ? (
        <View style={styles.transferIcon}>
          <Svg width={32} height={32} viewBox="0 0 24 24" accessible={false}>
            <Path
              d="M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4"
              stroke={theme.color.primary}
              strokeWidth={2}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        </View>
      ) : (
        <CategoryIcon iconKey={row.iconKey ?? undefined} size={44} />
      )}
      <View style={styles.rowText}>
        <Text numberOfLines={1} style={styles.description}>
          {description}
        </Text>
        <Text numberOfLines={1} style={styles.secondary}>
          {accounts}
          {category ? ` · ${category}` : ""}
        </Text>
        {highlighted && <Text style={styles.notice}>Saved record</Text>}
      </View>
      <Text
        numberOfLines={1}
        style={[
          styles.amount,
          row.type === "expense" && styles.expense,
          row.type === "income" && styles.income
        ]}
      >
        {amount}
      </Text>
    </Pressable>
  );
}
function HistoryCalendar({
  title,
  value,
  onClose,
  onSelect
}: {
  title: string;
  value: string;
  onClose: () => void;
  onSelect: (date: string) => void;
}) {
  const [month, setMonth] = useState(
    calendarDate.safeParse(value).success ? value.slice(0, 7) : currentMonth()
  );
  const [typed, setTyped] = useState(value);
  const range = monthRange(month),
    previous = adjacentMonth(month, -1),
    next = adjacentMonth(month, 1);
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <Screen title={`Choose ${title.toLowerCase()}`} showUserMenu={false}>
        <Button label="Cancel date selection" onPress={onClose} />
        <View style={styles.controls}>
          <Button
            label="Previous month"
            disabled={!previous}
            onPress={() => previous && setMonth(previous)}
          />
          <Text accessibilityRole="header" style={styles.date}>
            {monthLabel(month)}
          </Text>
          <Button
            label="Next month"
            disabled={!next}
            onPress={() => next && setMonth(next)}
          />
        </View>
        <View style={styles.calendar}>
          {Array.from({ length: Number(range.to.slice(8)) }, (_, index) => {
            const date = `${month}-${String(index + 1).padStart(2, "0")}`;
            return (
              <Pressable
                key={date}
                accessibilityRole="button"
                accessibilityLabel={`Choose ${date}`}
                accessibilityState={{ selected: date === value }}
                onPress={() => onSelect(date)}
                style={[
                  styles.calendarDay,
                  date === value && styles.highlighted
                ]}
              >
                <Text style={styles.date}>{index + 1}</Text>
              </Pressable>
            );
          })}
        </View>
        <Field
          label={`${title} (YYYY-MM-DD)`}
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
  section: { gap: 10, marginHorizontal: -8 },
  monthBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 6
  },
  dateBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    padding: 6,
    borderRadius: 16,
    backgroundColor: theme.color.surface,
    borderWidth: 1,
    borderColor: theme.color.softBorder
  },
  dateBarWrap: { flexWrap: "wrap" },
  filterBar: { flexDirection: "row", gap: 6 },
  filterBarWrap: { flexWrap: "wrap" },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 14 },
  pill: {
    minHeight: 42,
    borderRadius: theme.pillRadius,
    backgroundColor: theme.color.primarySoft,
    borderWidth: 1,
    borderColor: theme.color.softBorder,
    paddingHorizontal: 11,
    alignItems: "center",
    justifyContent: "center"
  },
  pillText: { fontSize: 13, color: theme.color.primary, fontWeight: "600" },
  primaryPill: {
    backgroundColor: theme.color.primary,
    borderColor: theme.color.primary
  },
  primaryPillText: { color: theme.color.onPrimary },
  arrow: {
    minWidth: 36,
    paddingHorizontal: 0,
    backgroundColor: theme.color.surface,
    borderWidth: 0
  },
  monthChoice: { flex: 1, maxWidth: 160 },
  calendarShortcut: { minWidth: 38, paddingHorizontal: 0 },
  dateChoice: { flex: 1, minWidth: 76, backgroundColor: theme.color.surface },
  dateDivider: { color: theme.color.muted, fontSize: 18 },
  apply: { minWidth: 60, paddingHorizontal: 8, borderRadius: 12 },
  filterChip: { flex: 1, minWidth: 0, paddingHorizontal: 6 },
  filterChipWide: { minWidth: 130 },
  scopeChip: { alignSelf: "flex-start" },
  textAction: {
    minHeight: 34,
    borderWidth: 0,
    backgroundColor: "transparent",
    paddingHorizontal: 4
  },
  controls: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    alignItems: "center"
  },
  group: {
    borderRadius: 17,
    borderWidth: 1,
    borderColor: theme.color.softBorder,
    overflow: "hidden"
  },
  groupHeader: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 6,
    backgroundColor: theme.color.primarySoft
  },
  date: { fontSize: 14, fontWeight: "700", color: theme.color.text },
  daySummary: { alignItems: "flex-end", flexShrink: 1 },
  dayTotal: { color: theme.color.muted, fontSize: 12, fontWeight: "600" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 64,
    borderTopWidth: 1,
    borderTopColor: theme.color.softBorder,
    backgroundColor: theme.color.surface
  },
  rowText: { flex: 1, gap: 2, minWidth: 0 },
  description: { color: theme.color.text, fontWeight: "700", fontSize: 15 },
  secondary: { fontSize: 12, color: theme.color.muted },
  amount: {
    fontSize: 14,
    fontWeight: "700",
    color: theme.color.text,
    flexShrink: 1,
    textAlign: "right"
  },
  expense: { color: theme.color.error },
  income: { color: "#176441" },
  highlighted: {
    backgroundColor: theme.color.primarySoft,
    borderColor: theme.color.primary,
    borderWidth: 2
  },
  notice: { color: theme.color.primary, fontSize: 15 },
  pressed: { opacity: 0.7 },
  transferIcon: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.color.primarySoft,
    borderRadius: 12
  },
  calendar: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  calendarDay: {
    minWidth: 48,
    minHeight: 48,
    padding: 10,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12
  }
});
