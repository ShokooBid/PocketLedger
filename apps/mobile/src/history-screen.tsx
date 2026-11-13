import { useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle
} from "react-native";
import Svg, { Path } from "react-native-svg";
import { Body, Button, Field, StateNotice } from "./ui";
import { theme } from "./theme";
import { CategoryIcon } from "./category-icon";
import { categoryPath } from "./category-hierarchy";
import { CategoryPicker } from "./finance-picker";
import { RangeDatePicker } from "./date-picker";
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
  const { filter, page, busy } = state;
  const [picker, setPicker] = useState<
    "account" | "category" | "type" | "range" | null
  >(null);
  const [accountSearch, setAccountSearch] = useState("");
  const category = state.categoryChoices.find(
    (row) => row.id === filter.categoryId
  );
  const account = state.accountChoices.find(
    (row) => row.id === filter.accountId
  );
  const dates = [...new Set(page?.items.map((row) => row.date) ?? [])];
  const disabled = busy || !props.ready || !props.active;
  const dropdown = picker === "account" || picker === "type";
  const modalOpen = picker === "category";
  function open(value: typeof picker) {
    setAccountSearch("");
    setPicker((current) => (current === value ? null : value));
  }
  function clearCategory() {
    state.updateFilters({
      categoryId: undefined,
      includeSubcategories: undefined
    });
    setPicker(null);
  }
  return (
    <>
      <View
        accessibilityElementsHidden={modalOpen}
        importantForAccessibility={modalOpen ? "no-hide-descendants" : "auto"}
        style={styles.section}
      >
        <HistoryPill
          label={`Date range: ${filter.from && filter.to ? `${filter.from} – ${filter.to}` : "All dates"}`}
          text={
            filter.from && filter.to
              ? `${filter.from} – ${filter.to}  ⌄`
              : "All dates  ⌄"
          }
          expanded={picker === "range"}
          disabled={disabled}
          onPress={() => open("range")}
        />
        {picker === "range" && (
          <RangeDatePicker
            from={filter.from}
            to={filter.to}
            disabled={disabled}
            onChange={state.updateFilters}
            onClose={() => setPicker(null)}
          />
        )}
        <View
          style={[styles.filterBar, fontScale > 1.3 && styles.filterBarWrap]}
        >
          <HistoryPill
            label={`Account: ${account?.name ?? (filter.accountId ? "Unavailable" : "All")}${account?.archivedAt ? " (archived)" : ""}`}
            text={`⌂  ${account?.name ?? "Account"}  ⌄`}
            disabled={disabled}
            onPress={() => open("account")}
            expanded={picker === "account"}
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
            expanded={picker === "type"}
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
        {dropdown && (
          <View
            style={[styles.dropdown, picker === "type" && styles.typeDropdown]}
            onAccessibilityEscape={() => setPicker(null)}
          >
            {picker === "account" && state.accountChoices.length > 6 && (
              <Field
                label="Search account choices"
                value={accountSearch}
                onChangeText={setAccountSearch}
              />
            )}
            <ScrollView
              accessibilityLabel={
                picker === "account"
                  ? "Account filter options"
                  : "Type filter options"
              }
              style={styles.dropdownList}
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
            >
              {picker === "account" ? (
                <>
                  <HistoryOption
                    label="All accounts"
                    selected={!filter.accountId}
                    disabled={disabled}
                    onPress={() => {
                      setPicker(null);
                      state.updateFilters({ accountId: undefined });
                    }}
                  />
                  {state.accountChoices
                    .filter((row) =>
                      row.name
                        .toLocaleLowerCase()
                        .includes(accountSearch.toLocaleLowerCase())
                    )
                    .map((row) => (
                      <HistoryOption
                        key={row.id}
                        label={`${row.name} · ${row.currency}${row.archivedAt ? " (archived)" : ""}`}
                        selected={row.id === filter.accountId}
                        disabled={disabled}
                        onPress={() => {
                          setPicker(null);
                          state.updateFilters({ accountId: row.id });
                        }}
                      />
                    ))}
                </>
              ) : (
                ([undefined, "income", "expense", "transfer"] as const).map(
                  (type) => (
                    <HistoryOption
                      key={type ?? "all"}
                      label={type ?? "All types"}
                      selected={filter.type === type}
                      disabled={disabled}
                      onPress={() => {
                        setPicker(null);
                        state.updateFilters({ type });
                      }}
                    />
                  )
                )
              )}
            </ScrollView>
          </View>
        )}
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
              state.updateFilters({
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
      {picker === "category" && (
        <CategoryPicker
          source={props.categories}
          mode="filter"
          selectedId={filter.categoryId ?? ""}
          onSelect={(id, rows) => {
            state.selectCategory(id, rows);
            setPicker(null);
          }}
          onClear={clearCategory}
          onClose={() => setPicker(null)}
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
  selected = false,
  expanded
}: {
  label: string;
  text: string;
  disabled: boolean;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
  selected?: boolean;
  expanded?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{
        disabled,
        selected,
        ...(expanded === undefined ? {} : { expanded })
      }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.pill,
        style,
        (pressed || disabled) && styles.pressed
      ]}
    >
      <Text numberOfLines={1} style={styles.pillText}>
        {text}
      </Text>
    </Pressable>
  );
}
function HistoryOption({
  label,
  selected,
  disabled,
  onPress
}: {
  label: string;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.dropdownOption,
        selected && styles.selectedOption,
        (pressed || disabled) && styles.pressed
      ]}
    >
      <Text style={styles.optionText}>{label}</Text>
      {selected && (
        <Text accessible={false} style={styles.optionCheck}>
          ✓
        </Text>
      )}
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
const styles = StyleSheet.create({
  section: { gap: 10, marginHorizontal: -8 },
  filterBar: { flexDirection: "row", gap: 6 },
  filterBarWrap: { flexWrap: "wrap" },
  dropdown: {
    width: "100%",
    maxWidth: 320,
    alignSelf: "flex-start",
    padding: 6,
    borderWidth: 1,
    borderColor: theme.color.softBorder,
    borderRadius: 16,
    backgroundColor: theme.color.surface,
    gap: 6
  },
  typeDropdown: { maxWidth: 200, alignSelf: "center" },
  dropdownList: { maxHeight: 240 },
  dropdownOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: theme.touchTarget,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10
  },
  selectedOption: { backgroundColor: theme.color.primarySoft },
  optionText: { flex: 1, color: theme.color.text, fontSize: 14 },
  optionCheck: { color: theme.color.primary, fontSize: 16 },
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
  filterChip: { flex: 1, minWidth: 0, paddingHorizontal: 6 },
  filterChipWide: { minWidth: 130 },
  scopeChip: { alignSelf: "flex-start" },
  textAction: {
    minHeight: 34,
    borderWidth: 0,
    backgroundColor: "transparent",
    paddingHorizontal: 4
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
  }
});
