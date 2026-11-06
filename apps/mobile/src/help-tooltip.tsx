import { useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { theme } from "./theme";

export function HelpTooltip({
  label,
  description
}: {
  label: string;
  description: string;
}) {
  const [open, setOpen] = useState(false);
  const focused = useRef(false);
  return (
    <View style={styles.container}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint="Shows more information."
        accessibilityState={{ expanded: open }}
        onHoverIn={() => setOpen(true)}
        onHoverOut={() => setOpen(false)}
        onFocus={() => {
          focused.current = true;
          setOpen(true);
        }}
        onBlur={() => {
          focused.current = false;
          setOpen(false);
        }}
        onPress={() => {
          if (focused.current) {
            focused.current = false;
            setOpen(true);
          } else setOpen((value) => !value);
        }}
        onAccessibilityEscape={() => setOpen(false)}
        style={styles.trigger}
      >
        <Text style={styles.symbol}>ⓘ</Text>
      </Pressable>
      {open && (
        <View style={styles.tooltip} accessibilityLiveRegion="polite">
          <Text style={styles.description}>{description}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { position: "relative", zIndex: 2 },
  trigger: {
    minWidth: theme.touchTarget,
    minHeight: theme.touchTarget,
    alignItems: "center",
    justifyContent: "center"
  },
  symbol: { color: theme.color.primary, fontSize: 20 },
  tooltip: {
    position: "absolute",
    top: theme.touchTarget,
    right: 0,
    width: 260,
    maxWidth: 260,
    padding: theme.space.md,
    borderRadius: theme.radius,
    backgroundColor: theme.color.primarySoft,
    borderWidth: 1,
    borderColor: theme.color.softBorder,
    elevation: 4,
    zIndex: 2
  },
  description: { color: theme.color.text, fontSize: 14, lineHeight: 21 }
});
