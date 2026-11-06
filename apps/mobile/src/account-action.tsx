import { useEffect, useRef, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { theme } from "./theme";

export function AccountAction({
  label,
  tooltip = label,
  children,
  onPress,
  disabled,
  selected = false,
  expanded,
  align = "right"
}: {
  label: string;
  tooltip?: string;
  children: ReactNode;
  onPress: () => void;
  disabled: boolean;
  selected?: boolean;
  expanded?: boolean;
  align?: "left" | "right";
}) {
  const [showLabel, setShowLabel] = useState(false);
  const longPressed = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );
  return (
    <View style={[styles.container, showLabel && styles.foreground]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint="Long press to show the action label."
        accessibilityState={{
          disabled,
          selected,
          ...(expanded === undefined ? {} : { expanded })
        }}
        disabled={disabled}
        delayLongPress={450}
        onHoverIn={() => setShowLabel(true)}
        onHoverOut={() => setShowLabel(false)}
        onFocus={() => setShowLabel(true)}
        onBlur={() => setShowLabel(false)}
        onPressIn={() => {
          longPressed.current = false;
        }}
        onLongPress={() => {
          longPressed.current = true;
          setShowLabel(true);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => setShowLabel(false), 2500);
        }}
        onPress={() => {
          // A label preview must never dispatch the account action on release.
          if (longPressed.current) {
            longPressed.current = false;
            return;
          }
          setShowLabel(false);
          onPress();
        }}
        onAccessibilityEscape={() => setShowLabel(false)}
        style={({ pressed }) => [
          styles.button,
          (pressed || disabled) && styles.dimmed
        ]}
      >
        <View style={[styles.icon, selected && styles.selected]}>
          {children}
        </View>
      </Pressable>
      {showLabel && (
        <View
          pointerEvents="none"
          style={[
            styles.tooltip,
            align === "left" ? styles.left : styles.right
          ]}
          accessibilityLiveRegion="polite"
        >
          <Text style={styles.label}>{tooltip}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { position: "relative" },
  foreground: { zIndex: 20 },
  button: {
    width: theme.touchTarget,
    height: theme.touchTarget,
    alignItems: "center",
    justifyContent: "center"
  },
  icon: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 11,
    backgroundColor: theme.color.primarySoft
  },
  selected: { borderWidth: 1, borderColor: theme.color.softBorder },
  dimmed: { opacity: 0.5 },
  tooltip: {
    position: "absolute",
    bottom: theme.touchTarget + 8,
    width: 180,
    borderRadius: 12,
    padding: theme.space.sm,
    backgroundColor: theme.color.text,
    elevation: 6,
    zIndex: 20
  },
  left: { left: 0 },
  right: { right: 0 },
  label: {
    color: theme.color.onPrimary,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center"
  }
});
