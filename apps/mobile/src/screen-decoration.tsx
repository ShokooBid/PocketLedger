import { useId } from "react";
import { StyleSheet, View } from "react-native";
import Svg, {
  Circle,
  Defs,
  LinearGradient,
  Path,
  Stop
} from "react-native-svg";
import { theme } from "./theme";

// Hand-drawn vectors, not a screenshot asset. Only ornamental geometry lives
// here; the screen/controls remain normal native accessible components.
export function ScreenDecoration({
  prominent = false
}: {
  prominent?: boolean;
}) {
  return (
    <View
      pointerEvents="none"
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={StyleSheet.absoluteFill}
    >
      <Shape edge="top" prominent={prominent} />
      <Shape edge="bottom" prominent={prominent} />
    </View>
  );
}
function Shape({
  edge,
  prominent
}: {
  edge: "top" | "bottom";
  prominent: boolean;
}) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  return (
    <View
      style={[
        edge === "top" ? styles.top : styles.bottom,
        prominent
          ? edge === "top"
            ? styles.topProminent
            : styles.bottomProminent
          : styles.subtle
      ]}
    >
      <Svg width="100%" height="100%" viewBox="0 0 320 180" accessible={false}>
        <Defs>
          <LinearGradient id={id} x1="0%" y1="50%" x2="100%" y2="50%">
            <Stop offset="0%" stopColor={theme.color.gradientStart} />
            <Stop offset="100%" stopColor={theme.color.gradientEnd} />
          </LinearGradient>
        </Defs>
        {edge === "top" ? (
          <>
            <Path
              fill={`url(#${id})`}
              d="M0 0H245C255 23 235 28 246 45C258 62 275 80 264 107C251 143 207 156 178 136C153 119 151 103 121 115C76 138 28 135 0 101Z"
            />
            <Circle cx="281" cy="25" r="14" fill={theme.color.gradientEnd} />
            <Circle
              cx="143"
              cy="144"
              r="5.5"
              fill={theme.color.decorationDot}
            />
          </>
        ) : (
          <Path
            fill={`url(#${id})`}
            d="M9 180C7 133 30 83 76 72C115 62 134 80 158 85C184 95 187 68 213 65C250 57 286 89 285 125C280 148 281 163 299 180Z"
          />
        )}
      </Svg>
    </View>
  );
}
const styles = StyleSheet.create({
  top: { position: "absolute", top: 0, left: 0, width: 190, height: 107 },
  bottom: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 240,
    height: 135
  },
  topProminent: { width: 280, height: 158 },
  bottomProminent: { width: 320, height: 180 },
  subtle: { opacity: 0.14 }
});
