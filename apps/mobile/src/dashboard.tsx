import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Body, Button, Field, StateNotice } from "./ui";
import { theme } from "./theme";
import { currencyExponents, type Currency } from "./transaction-data";
import {
  adjacentMonth,
  currentMonth,
  dashboardFailureMessage,
  moneyLabel,
  monthLabel,
  monthRange,
  monthSchema,
  type DashboardSource,
  type DashboardSummary,
  type DashboardSelection
} from "./dashboard-data";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      summary: DashboardSummary;
      key: string;
      source: DashboardSource;
    };

export function Dashboard({
  source,
  active = true,
  demo = false,
  initialMonth = currentMonth(),
  onAdd,
  onOpenDetail
}: {
  source: DashboardSource;
  active?: boolean;
  demo?: boolean;
  initialMonth?: string;
  onAdd: (selection: DashboardSelection) => void;
  onOpenDetail: (id: string) => void;
}) {
  const [month, setMonth] = useState(initialMonth);
  const [monthInput, setMonthInput] = useState(initialMonth);
  const [invalidMonth, setInvalidMonth] = useState(false);
  const [choosingMonth, setChoosingMonth] = useState(false);
  const [currency, setCurrency] = useState<Currency>("USD");
  const [choosingCurrency, setChoosingCurrency] = useState(false);
  const [reload, setReload] = useState(0);
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const sequence = useRef(0);
  const key = `${month}_${currency}`;
  const refresh = useCallback(() => {
    sequence.current++;
    setState({ status: "loading" });
    setReload((value) => value + 1);
  }, []);
  useEffect(
    () => (active ? source.subscribe(refresh) : undefined),
    [source, active, refresh]
  );
  useEffect(() => {
    if (!active) {
      sequence.current++;
      setState({ status: "loading" });
      return;
    }
    const request = ++sequence.current;
    let cancelled = false;
    setState({ status: "loading" });
    void source.summary({ month, currency }).then(
      (summary) => {
        if (!cancelled && request === sequence.current)
          setState({ status: "ready", summary, key, source });
      },
      (error: unknown) => {
        if (!cancelled && request === sequence.current)
          setState({
            status: "error",
            message: dashboardFailureMessage(error)
          });
      }
    );
    return () => {
      cancelled = true;
    };
  }, [source, active, month, currency, key, reload]);

  function selectMonth(next: string) {
    if (!monthSchema.safeParse(next).success) {
      setInvalidMonth(true);
      return;
    }
    setInvalidMonth(false);
    setMonthInput(next);
    setMonth(next);
    setChoosingMonth(false);
    refresh();
  }
  const summary =
    active &&
    state.status === "ready" &&
    state.key === key &&
    state.source === source
      ? state.summary
      : null;
  const previous = adjacentMonth(month, -1);
  const next = adjacentMonth(month, 1);
  const spending =
    summary?.categoryBreakdown
      .filter((group) => group.expensesMinor > 0)
      .sort(
        (a, b) =>
          b.expensesMinor - a.expensesMinor ||
          a.categoryId.localeCompare(b.categoryId)
      ) ?? [];
  return (
    <>
      {demo && (
        <Body>
          Demo only — you are not signed in. Summaries use this demo's temporary
          transactions; no API requests or saved financial data.
        </Body>
      )}
      <Text
        accessibilityRole="header"
        accessibilityLiveRegion="polite"
        style={styles.heading}
      >
        {monthLabel(month)} · {currency}
      </Text>
      <Body>One currency at a time. Net is income minus expenses.</Body>
      <View style={styles.controls}>
        <View style={styles.control}>
          <Button
            label="Previous month"
            disabled={!previous}
            onPress={() => previous && selectMonth(previous)}
          />
        </View>
        <View style={styles.control}>
          <Button
            label="Next month"
            disabled={!next}
            onPress={() => next && selectMonth(next)}
          />
        </View>
      </View>
      <View style={styles.controls}>
        <View style={styles.control}>
          <Button
            label="Choose month"
            selected={choosingMonth}
            onPress={() => setChoosingMonth((value) => !value)}
          />
        </View>
        <View style={styles.control}>
          <Button
            label={`Change currency (${currency})`}
            onPress={() => setChoosingCurrency((value) => !value)}
          />
        </View>
      </View>
      {choosingMonth && (
        <>
          <Field
            label="Month (YYYY-MM)"
            value={monthInput}
            onChangeText={setMonthInput}
            autoCapitalize="none"
          />
          <Button
            label="Show selected month"
            onPress={() => selectMonth(monthInput)}
          />
        </>
      )}
      {invalidMonth && (
        <StateNotice
          kind="error"
          title="Check the month"
          message="Enter a month as YYYY-MM, from 0001-01 through 9999-12."
        />
      )}
      {choosingCurrency &&
        (Object.keys(currencyExponents) as Currency[]).map((value) => (
          <Button
            key={value}
            label={`Summary currency ${value}`}
            selected={value === currency}
            onPress={() => {
              setCurrency(value);
              setChoosingCurrency(false);
              refresh();
            }}
          />
        ))}
      <Button
        label="Refresh summary"
        onPress={refresh}
        disabled={state.status === "loading"}
      />
      {!summary &&
        (state.status === "error" ? (
          <StateNotice
            kind="error"
            title="Summary unavailable"
            message={state.message}
            onRetry={refresh}
          />
        ) : (
          <StateNotice
            kind="loading"
            title="Loading summary"
            message={`Loading ${monthLabel(month)} in ${currency}.`}
          />
        ))}
      {summary && (
        <>
          <SummaryCard
            label="Income"
            value={moneyLabel(summary.incomeMinor, currency)}
          />
          <SummaryCard
            label="Expenses"
            value={moneyLabel(summary.expensesMinor, currency)}
          />
          <SummaryCard
            label={
              summary.netMinor < 0
                ? "Net deficit"
                : summary.netMinor > 0
                  ? "Net surplus"
                  : "Net balanced"
            }
            value={moneyLabel(summary.netMinor, currency)}
          />
          {summary.categoryBreakdown.length === 0 ? (
            <StateNotice
              kind="empty"
              title="No transactions this month"
              message={`No ${currency} transactions were recorded for ${monthLabel(month)}. Add a transaction to get started, or choose another month or currency.`}
            />
          ) : (
            <>
              <Text accessibilityRole="header" style={styles.heading}>
                Category spending
              </Text>
              {spending.length === 0 && (
                <Body>No expenses in this month and currency.</Body>
              )}
              {spending.map((group) => (
                <SummaryCard
                  key={group.categoryId}
                  label={group.categoryName}
                  value={`Expenses: ${moneyLabel(group.expensesMinor, currency)}`}
                />
              ))}
              <Text accessibilityRole="header" style={styles.heading}>
                Recent transactions
              </Text>
              <Body>
                Up to five transactions in this month and currency, newest date
                first.
              </Body>
              {summary.recentTransactions.map((row) => (
                <View key={row.id} style={styles.card}>
                  <Body>{row.merchant}</Body>
                  <Body>
                    {row.direction === "income" ? "Income" : "Expense"}:{" "}
                    {moneyLabel(row.amountMinor, currency)}
                  </Body>
                  <Body>
                    {row.date} ·{" "}
                    {summary.categoryBreakdown.find(
                      (group) => group.categoryId === row.categoryId
                    )?.categoryName ?? "Unavailable category"}
                  </Body>
                  <Button
                    label={`View ${row.merchant} on ${row.date}`}
                    onPress={() => onOpenDetail(row.id)}
                  />
                </View>
              ))}
            </>
          )}
        </>
      )}
      <Button
        label="Add transaction"
        hint={`Opens a new ${currency} transaction dated ${monthRange(month).from}; you can edit the date.`}
        onPress={() => onAdd({ month, currency })}
      />
    </>
  );
}
function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={`${label}. ${value}`}
      style={styles.card}
    >
      <Text style={styles.cardLabel}>{label}</Text>
      <Text style={styles.amount}>{value}</Text>
    </View>
  );
}
const styles = StyleSheet.create({
  controls: { flexDirection: "row", flexWrap: "wrap", gap: theme.space.sm },
  control: { flexGrow: 1, flexBasis: 160 },
  card: {
    backgroundColor: theme.color.surface,
    padding: theme.space.md,
    borderRadius: theme.radius,
    gap: theme.space.sm
  },
  heading: { color: theme.color.text, fontSize: 22, fontWeight: "700" },
  cardLabel: {
    color: theme.color.muted,
    fontSize: theme.font.body,
    fontWeight: "600"
  },
  amount: { color: theme.color.text, fontSize: 24, fontWeight: "700" }
});
