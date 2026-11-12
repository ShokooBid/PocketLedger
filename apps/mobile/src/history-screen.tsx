import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
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
        <View style={styles.controls}>
          <Button
            label="Previous month"
            disabled={disabled || !previous}
            onPress={() => previous && state.selectMonth(previous)}
          />
          <Button
            label={exactMonth ? monthLabel(anchor) : "Choose month"}
            disabled={disabled}
            onPress={() => {
              setMonthInput(anchor);
              open("month");
            }}
          />
          <Button
            label="Next month"
            disabled={disabled || !next}
            onPress={() => next && state.selectMonth(next)}
          />
        </View>
        <View style={styles.controls}>
          <Button
            label={`From: ${filter.from ?? "Any date"}`}
            disabled={disabled}
            onPress={() => open("from")}
          />
          <Button
            label={`To: ${filter.to ?? "Any date"}`}
            disabled={disabled}
            onPress={() => open("to")}
          />
        </View>
        <View style={styles.controls}>
          <Button
            label={`Account: ${account?.name ?? (filter.accountId ? "Unavailable" : "All")}${account?.archivedAt ? " (archived)" : ""}`}
            disabled={disabled}
            onPress={() => open("account")}
          />
          <Button
            label={`Type: ${filter.type ?? "All"}`}
            disabled={disabled}
            onPress={() => open("type")}
          />
          <Button
            label={`Category: ${category ? categoryPath(category, state.categoryChoices) : filter.categoryId ? "Unavailable" : "All"}`}
            disabled={disabled}
            onPress={() => open("category")}
          />
        </View>
        {category && !category.parentId && (
          <Button
            label={
              filter.includeSubcategories
                ? "Category scope: Parent and subcategories"
                : "Category scope: Exact category"
            }
            selected={!!filter.includeSubcategories}
            disabled={disabled}
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
        <View style={styles.controls}>
          <Button
            label="Apply filters"
            variant="primary"
            disabled={disabled}
            onPress={state.apply}
          />
          <Button
            label="Clear filters"
            disabled={disabled}
            onPress={state.clear}
          />
          <Button
            label="Refresh history"
            disabled={disabled}
            onPress={state.refresh}
          />
        </View>
        {page && (
          <Body>
            Showing {page.applied.from ?? "all dates"}
            {page.applied.to ? ` to ${page.applied.to}` : ""} ·{" "}
            {page.applied.type ?? "all types"} ·{" "}
            {state.accountChoices.find(
              (row) => row.id === page.applied.accountId
            )?.name ?? "all accounts"}{" "}
            ·{" "}
            {state.categoryChoices.find(
              (row) => row.id === page.applied.categoryId
            )?.name ?? "all categories"}
            {page.applied.includeSubcategories
              ? " including subcategories"
              : ""}
            . Net excludes transfers.
          </Body>
        )}
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
              {page?.days
                .filter((day) => day.date === date)
                .map((day) => (
                  <Text key={day.currency} style={styles.dayTotal}>
                    {day.count}{" "}
                    {day.count === 1 ? "transaction" : "transactions"} · Net{" "}
                    {signedMoney(day.netMinor, day.currency)}
                  </Text>
                ))}
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
      accessibilityHint="Open transaction details"
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
        <Text style={styles.description}>{description}</Text>
        <Text style={styles.secondary}>
          {accounts}
          {category ? ` · ${category}` : ""}
        </Text>
        {transfer && (
          <Text style={styles.secondary}>{typeLabel} · excluded from net</Text>
        )}
        <Text
          style={[
            styles.amount,
            row.type === "expense" && styles.expense,
            row.type === "income" && styles.income
          ]}
        >
          {amount}
        </Text>
        {highlighted && <Text style={styles.notice}>Saved record</Text>}
      </View>
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
  section: { gap: 12 },
  controls: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    alignItems: "center"
  },
  group: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.color.softBorder,
    overflow: "hidden"
  },
  groupHeader: {
    padding: 12,
    gap: 4,
    backgroundColor: theme.color.primarySoft
  },
  date: { fontSize: 16, fontWeight: "700", color: theme.color.text },
  dayTotal: { color: theme.color.muted, fontSize: 15 },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    padding: 14,
    minHeight: 72,
    borderTopWidth: 1,
    borderTopColor: theme.color.softBorder,
    backgroundColor: theme.color.surface
  },
  rowText: { flex: 1, gap: 4 },
  description: { color: theme.color.text, fontWeight: "700", fontSize: 17 },
  secondary: { fontSize: 15, color: theme.color.muted },
  amount: { fontSize: 18, fontWeight: "700", color: theme.color.text },
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
