import { type PropsWithChildren } from "react";
import { Link, useRouter } from "expo-router";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { theme } from "./theme";

export function Body({ children }: PropsWithChildren) {
  return <Text style={styles.body}>{children}</Text>;
}

export function Button({
  label,
  onPress,
  hint,
  selected = false
}: {
  label: string;
  onPress: () => void;
  hint?: string;
  selected?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

export function Screen({
  title,
  children,
  back = false
}: PropsWithChildren<{ title: string; back?: boolean }>) {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {back && (
          <Button
            label="Back to dashboard"
            onPress={() => router.replace("/")}
          />
        )}
        <Text
          accessibilityRole="header"
          accessibilityLabel={`${title} screen`}
          style={styles.heading}
        >
          {title}
        </Text>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function NavigationLink({
  href,
  label
}: {
  href:
    | "/transactions"
    | "/categories"
    | "/import"
    | "/settings"
    | "/sign-in"
    | "/";
  label: string;
}) {
  return (
    <Link href={href} accessibilityLabel={label} style={styles.link}>
      {label}
    </Link>
  );
}

export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.body}>{label}</Text>
      <TextInput
        {...props}
        accessibilityLabel={label}
        placeholderTextColor={theme.color.muted}
        style={styles.input}
      />
    </View>
  );
}

export function StateNotice({
  kind,
  title,
  message,
  onRetry
}: {
  kind: "loading" | "empty" | "error";
  title: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <View style={styles.notice}>
      <View
        accessible
        accessibilityRole={kind === "error" ? "alert" : "text"}
        accessibilityLiveRegion="polite"
        accessibilityLabel={`${title}. ${message}`}
        accessibilityState={{ busy: kind === "loading" }}
      >
        {kind === "loading" && (
          <ActivityIndicator accessible={false} color={theme.color.primary} />
        )}
        <Text style={[styles.noticeTitle, kind === "error" && styles.error]}>
          {title}
        </Text>
        <Body>{message}</Body>
      </View>
      {onRetry && <Button label="Try again" onPress={onRetry} />}
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: theme.color.background },
  content: {
    flexGrow: 1,
    padding: theme.space.lg,
    gap: theme.space.md,
    width: "100%",
    maxWidth: 640,
    alignSelf: "center"
  },
  heading: {
    color: theme.color.text,
    fontSize: theme.font.heading,
    fontWeight: "700"
  },
  body: { color: theme.color.text, fontSize: theme.font.body, lineHeight: 24 },
  button: {
    backgroundColor: theme.color.primary,
    borderRadius: theme.radius,
    minHeight: theme.touchTarget,
    padding: theme.space.md,
    alignItems: "center",
    justifyContent: "center"
  },
  pressed: { opacity: 0.8 },
  buttonText: {
    color: theme.color.onPrimary,
    fontSize: theme.font.body,
    fontWeight: "600",
    textAlign: "center"
  },
  link: {
    color: theme.color.primary,
    backgroundColor: theme.color.surface,
    fontSize: theme.font.body,
    fontWeight: "600",
    textDecorationLine: "underline",
    minHeight: theme.touchTarget,
    padding: theme.space.md,
    borderRadius: theme.radius
  },
  field: { gap: theme.space.sm },
  input: {
    color: theme.color.text,
    backgroundColor: theme.color.surface,
    fontSize: theme.font.body,
    minHeight: theme.touchTarget,
    padding: theme.space.md,
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius
  },
  notice: {
    backgroundColor: theme.color.surface,
    padding: theme.space.md,
    borderRadius: theme.radius,
    gap: theme.space.md
  },
  noticeTitle: {
    color: theme.color.text,
    fontSize: theme.font.body,
    fontWeight: "700",
    marginBottom: theme.space.sm
  },
  error: { color: theme.color.error }
});
