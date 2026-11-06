import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren
} from "react";
import { Link, usePathname } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { useSession } from "./session";
import { theme } from "./theme";

type MenuActions = {
  signOut: () => void;
  signOutLabel: string;
};
const Context = createContext<MenuActions | null>(null);

export function UserMenuProvider({ children }: PropsWithChildren) {
  const { session, controller, exitDemo } = useSession();
  const demo = session.status === "demo";
  return (
    <Context.Provider
      value={
        demo || session.status === "authenticated"
          ? {
              signOut: () => (demo ? exitDemo() : void controller.logout()),
              signOutLabel: demo
                ? "Exit demo and return to sign in"
                : "Sign out"
            }
          : null
      }
    >
      {children}
    </Context.Provider>
  );
}

export function UserMenu() {
  const actions = useContext(Context);
  const [open, setOpen] = useState(false);
  const focused = useRef(false);
  const pathname = usePathname();
  useEffect(() => {
    setOpen(false);
    focused.current = false;
  }, [pathname]);
  if (!actions) return null;
  return (
    <Pressable
      accessible={false}
      onHoverIn={() => setOpen(true)}
      onHoverOut={() => setOpen(false)}
      onAccessibilityEscape={() => setOpen(false)}
      style={styles.container}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="User menu"
        accessibilityHint="Settings and sign out."
        accessibilityState={{ expanded: open }}
        onPress={() => {
          if (focused.current) {
            focused.current = false;
            setOpen(true);
          } else setOpen((value) => !value);
        }}
        onFocus={() => {
          focused.current = true;
          setOpen(true);
        }}
        onBlur={() => {
          focused.current = false;
        }}
        style={styles.avatar}
      >
        <Svg width={40} height={40} viewBox="0 0 40 40" accessible={false}>
          <Circle cx={20} cy={14} r={7} fill={theme.color.onPrimary} />
          <Path
            d="M7 36v-3c0-7 5-11 13-11s13 4 13 11v3Z"
            fill={theme.color.onPrimary}
          />
        </Svg>
      </Pressable>
      {open && (
        <View style={styles.menu}>
          <Link href="/settings" asChild>
            <Pressable
              accessibilityRole="link"
              accessibilityLabel="Open settings"
              onPress={() => setOpen(false)}
              style={styles.item}
            >
              <Text style={styles.itemText}>Settings</Text>
            </Pressable>
          </Link>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={actions.signOutLabel}
            onPress={() => {
              setOpen(false);
              actions.signOut();
            }}
            style={styles.item}
          >
            <Text style={styles.itemText}>
              {actions.signOutLabel === "Sign out" ? "Sign out" : "Exit demo"}
            </Text>
          </Pressable>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: "flex-end",
    alignItems: "flex-end",
    position: "relative",
    zIndex: 10
  },
  avatar: {
    width: theme.touchTarget,
    height: theme.touchTarget,
    borderRadius: theme.pillRadius,
    backgroundColor: theme.color.primary,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center"
  },
  menu: {
    position: "absolute",
    right: 0,
    top: theme.touchTarget,
    width: 200,
    padding: theme.space.sm,
    backgroundColor: theme.color.surface,
    borderWidth: 1,
    borderColor: theme.color.softBorder,
    borderRadius: theme.radius,
    elevation: 6,
    zIndex: 10
  },
  item: {
    minHeight: theme.touchTarget,
    padding: theme.space.md,
    justifyContent: "center",
    borderRadius: theme.radius
  },
  itemText: {
    color: theme.color.primary,
    fontSize: theme.font.body,
    fontWeight: "600"
  }
});
