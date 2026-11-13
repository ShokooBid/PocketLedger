import {
  useCallback,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode
} from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import DateTimePicker, { useDefaultStyles } from "react-native-ui-datepicker";
import { pickerDate } from "./date-picker-data";
import { theme } from "./theme";
import { Button } from "./ui";

type PickerProps = ComponentProps<typeof DateTimePicker>;
type PickerSelection = Parameters<NonNullable<PickerProps["onChange"]>>[0];

export function DatePicker(props: PickerProps) {
  const defaults = useDefaultStyles("light");
  const current = useRef(props);
  current.current = props;
  // The library retains its initial selection callback. Forward to the latest
  // draft/disabled state while the inline calendar stays mounted.
  const onChange = useCallback((selection: PickerSelection) => {
    const latest = current.current;
    if (latest.mode === "single" && "date" in selection)
      latest.onChange?.(selection);
    else if (latest.mode === "range" && "startDate" in selection)
      latest.onChange?.(selection);
    else if (latest.mode === "multiple" && "dates" in selection)
      latest.onChange?.(selection);
  }, []);
  return (
    <View style={styles.calendar}>
      <DateTimePicker
        {...props}
        onChange={onChange}
        styles={{
          ...defaults,
          selected: { backgroundColor: theme.color.primary, borderRadius: 12 },
          selected_label: { color: theme.color.onPrimary },
          range_fill: { backgroundColor: theme.color.primarySoft },
          range_start_label: { color: theme.color.onPrimary },
          range_end_label: { color: theme.color.onPrimary },
          today: { borderColor: theme.color.primary, borderWidth: 1 },
          today_label: { color: theme.color.primary }
        }}
      />
    </View>
  );
}

export function SingleDateField({
  value,
  onChange,
  disabled = false,
  renderTrigger
}: {
  value: string;
  onChange: (date: string) => void;
  disabled?: boolean;
  renderTrigger?: (toggle: () => void, expanded: boolean) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const toggle = () => {
    if (!disabled) setOpen((current) => !current);
  };
  return (
    <>
      {renderTrigger ? (
        renderTrigger(toggle, open)
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Choose transaction date"
          accessibilityHint={value}
          accessibilityState={{ disabled, expanded: open }}
          disabled={disabled}
          onPress={toggle}
          style={styles.trigger}
        >
          <Text style={styles.label}>Date: {value}</Text>
        </Pressable>
      )}
      {open && (
        <>
          <DatePicker
            mode="single"
            date={value}
            onChange={({ date }) => {
              const next = pickerDate(date);
              if (!disabled && next) {
                onChange(next);
                setOpen(false);
              }
            }}
          />
          <Button
            label="Cancel date selection"
            onPress={() => setOpen(false)}
          />
        </>
      )}
    </>
  );
}

export function RangeDatePicker({
  from,
  to,
  disabled,
  onChange,
  onClose
}: {
  from: string | undefined;
  to: string | undefined;
  disabled: boolean;
  onChange: (range: {
    from: string | undefined;
    to: string | undefined;
  }) => void;
  onClose: () => void;
}) {
  const [range, setRange] = useState({ from, to });
  function select(next: typeof range) {
    if (disabled) return;
    onChange(next);
    onClose();
  }
  return (
    <View style={styles.range}>
      <DatePicker
        mode="range"
        startDate={range.from}
        endDate={range.to}
        allowRangeReset
        max={366}
        onChange={({ startDate, endDate }) => {
          if (disabled) return;
          const next = { from: pickerDate(startDate), to: pickerDate(endDate) };
          setRange(next);
          if (next.from && next.to) select(next);
        }}
      />
      <View style={styles.rangeActions}>
        {range.from && !range.to && (
          <Button
            label="Use selected day"
            disabled={disabled}
            onPress={() => select({ from: range.from, to: range.from })}
          />
        )}
        <Button
          label="All dates"
          disabled={disabled}
          onPress={() => select({ from: undefined, to: undefined })}
        />
        <Button label="Cancel date selection" onPress={onClose} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  range: { gap: 8 },
  rangeActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "flex-end"
  },
  calendar: {
    padding: 8,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.color.softBorder,
    backgroundColor: theme.color.surface
  },
  trigger: {
    minHeight: theme.touchTarget,
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.color.softBorder,
    backgroundColor: theme.color.primarySoft,
    justifyContent: "center"
  },
  label: { color: theme.color.text, fontSize: 16 }
});
