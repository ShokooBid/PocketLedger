import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { Account } from "./account-data";
import { theme } from "./theme";

const options = [
  { value: "cash", label: "Cash" },
  { value: "bank", label: "Bank" },
  { value: "credit", label: "Credit" },
  { value: "other", label: "Other" }
] as const;

export function AccountTypeSelect({
  value,
  onChange,
  disabled
}: {
  value: Account["type"];
  onChange: (value: Account["type"]) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const expanded = open && !disabled;
  return (
    <View style={styles.field}>
      <Text style={styles.label}>Account type</Text>
      <Pressable
        accessibilityRole="combobox"
        accessibilityLabel="Account type"
        accessibilityValue={{
          text: options.find((row) => row.value === value)!.label
        }}
        accessibilityState={{ expanded, disabled }}
        disabled={disabled}
        onPress={() => setOpen((current) => !current)}
        onAccessibilityEscape={() => setOpen(false)}
        style={[styles.control, disabled && styles.disabled]}
      >
        <Text style={styles.label}>
          {options.find((row) => row.value === value)!.label}
        </Text>
        <Text accessible={false} style={styles.label}>
          {expanded ? "⌃" : "⌄"}
        </Text>
      </Pressable>
      {expanded && (
        <View
          accessibilityRole="radiogroup"
          accessibilityLabel="Account types"
          style={styles.options}
        >
          {options.map((option) => (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityLabel={option.label}
              accessibilityState={{ checked: value === option.value }}
              onPress={() => {
                onChange(option.value);
                setOpen(false);
              }}
              style={[styles.option, value === option.value && styles.selected]}
            >
              <Text style={styles.label}>{option.label}</Text>
              {value === option.value && (
                <Text accessible={false} style={styles.label}>
                  ✓
                </Text>
              )}
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: theme.space.sm },
  label: { color: theme.color.text, fontSize: theme.font.body },
  control: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: theme.touchTarget,
    paddingHorizontal: 20,
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.pillRadius,
    backgroundColor: theme.color.surface
  },
  options: {
    borderWidth: 1,
    borderColor: theme.color.softBorder,
    borderRadius: theme.radius,
    overflow: "hidden"
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: theme.touchTarget,
    paddingHorizontal: 20,
    backgroundColor: theme.color.surface
  },
  selected: { backgroundColor: theme.color.primarySoft },
  disabled: { opacity: 0.6 }
});
