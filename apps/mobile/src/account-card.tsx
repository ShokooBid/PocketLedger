import { useState, type PropsWithChildren } from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";
import type { Account } from "./account-data";
import { AccountAction } from "./account-action";
import { theme } from "./theme";

type IconName = Account["type"] | "eye" | "rename" | "star" | "archive";
function AccountIcon({
  name,
  active = false,
  size = 18
}: {
  name: IconName;
  active?: boolean;
  size?: number;
}) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={active ? theme.color.primary : theme.color.muted}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {name === "eye" && (
        <>
          <Path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
          <Circle cx={12} cy={12} r={3} />
        </>
      )}
      {name === "rename" && (
        <Path d="m14 5 5 5M3 21l2-7L17 2a2 2 0 0 1 5 5L10 19l-7 2Z" />
      )}
      {name === "star" && (
        <Path
          d="m12 2 3 6.5 7 1-5 5 1.2 7L12 18l-6.2 3.5 1.2-7-5-5 7-1Z"
          fill={active ? theme.color.primary : "none"}
        />
      )}
      {name === "archive" && (
        <>
          <Rect x={2} y={3} width={20} height={5} rx={1} />
          <Path d="M4 8v13h16V8M9 12h6" />
        </>
      )}
      {name === "bank" && (
        <Path d="m2 8 10-6 10 6H2Zm2 13h16M6 11v7m6-7v7m6-7v7" />
      )}
      {name === "cash" && (
        <>
          <Path d="M4 7V5l13-3 1 5M16 12h6v6h-6a3 3 0 0 1 0-6Z" />
          <Rect x={2} y={7} width={20} height={15} rx={3} />
        </>
      )}
      {name === "credit" && (
        <>
          <Rect x={2} y={4} width={20} height={16} rx={3} />
          <Path d="M2 9h20M6 15h4" />
        </>
      )}
      {name === "other" && (
        <>
          <Rect x={3} y={3} width={18} height={18} rx={4} />
          <Path d="M8 12h8m-4-4v8" />
        </>
      )}
    </Svg>
  );
}

const accountTypes = {
  bank: "Bank",
  cash: "Cash",
  credit: "Credit",
  other: "Other"
} as const;

export function AccountCard({
  account,
  isDefault,
  expanded,
  disabled,
  viewDisabled,
  defaultEligible,
  onToggleDetails,
  onRename,
  onDefault,
  onArchive,
  children
}: PropsWithChildren<{
  account: Account;
  isDefault: boolean;
  expanded: boolean;
  disabled: boolean;
  viewDisabled: boolean;
  defaultEligible: boolean;
  onToggleDetails: () => void;
  onRename: () => void;
  onDefault: () => void;
  onArchive: () => void;
}>) {
  const [headerWidth, setHeaderWidth] = useState<number | null>(null);
  const { fontScale } = useWindowDimensions();
  // Reserve the badge, four full touch targets and a readable name before
  // placing actions on the same row. Avoid flex-basis/wrapping an unbounded row.
  const stacked = headerWidth !== null && headerWidth < 238 + 46 * fontScale;
  return (
    <View style={styles.card}>
      <View
        onLayout={({ nativeEvent }) => setHeaderWidth(nativeEvent.layout.width)}
        style={[styles.top, stacked && styles.topStacked]}
      >
        <View style={[styles.identity, stacked && styles.identityStacked]}>
          <View style={styles.badge}>
            <AccountIcon name={account.type} active size={22} />
          </View>
          <View style={styles.nameBlock}>
            <Text
              accessibilityRole="header"
              numberOfLines={1}
              ellipsizeMode="tail"
              style={styles.name}
            >
              {account.name}
            </Text>
            <Text style={styles.metadata}>
              {accountTypes[account.type]} · {account.currency} ·{" "}
              {account.archivedAt ? "Archived" : "Active"}
            </Text>
          </View>
        </View>
        <View style={[styles.actions, stacked && styles.actionsStacked]}>
          <AccountAction
            label={`${expanded ? "Hide" : "View"} balance for ${account.name}`}
            tooltip={expanded ? "Hide balance" : "View balance"}
            expanded={expanded}
            selected={expanded}
            disabled={viewDisabled}
            onPress={onToggleDetails}
            align="left"
          >
            <AccountIcon name="eye" active={expanded} />
          </AccountAction>
          {!account.archivedAt && (
            <>
              <AccountAction
                label={`Rename ${account.name}`}
                disabled={disabled}
                onPress={onRename}
                align="left"
              >
                <AccountIcon name="rename" />
              </AccountAction>
              {defaultEligible && (
                <AccountAction
                  label={`Use ${account.name} as default`}
                  selected={isDefault}
                  disabled={disabled}
                  onPress={onDefault}
                >
                  <AccountIcon name="star" active={isDefault} />
                </AccountAction>
              )}
              <AccountAction
                label={`Archive ${account.name}`}
                disabled={disabled}
                onPress={onArchive}
              >
                <AccountIcon name="archive" />
              </AccountAction>
            </>
          )}
        </View>
      </View>
      {expanded && <View style={styles.details}>{children}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 12,
    borderWidth: 1,
    borderColor: theme.color.softBorder,
    borderRadius: theme.radius,
    backgroundColor: theme.color.surface,
    gap: 12
  },
  top: {
    flexDirection: "row",
    width: "100%",
    alignItems: "center",
    gap: 6,
    zIndex: 2
  },
  identity: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flex: 1,
    minWidth: 0
  },
  topStacked: { flexDirection: "column", alignItems: "stretch", gap: 8 },
  identityStacked: { flex: 0, width: "100%" },
  badge: {
    width: 34,
    height: 34,
    flexShrink: 0,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.color.primarySoft
  },
  nameBlock: { flex: 1, minWidth: 0, gap: 2 },
  name: {
    color: theme.color.text,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: "700"
  },
  metadata: { color: theme.color.muted, fontSize: 11, lineHeight: 15 },
  actions: { flexDirection: "row", flexShrink: 0 },
  actionsStacked: { alignSelf: "flex-end" },
  details: {
    padding: theme.space.md,
    borderRadius: 18,
    backgroundColor: theme.color.primarySoft,
    gap: theme.space.sm
  }
});
