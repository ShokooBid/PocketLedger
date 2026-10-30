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
import { ScreenDecoration } from "./screen-decoration";

export function Body({
  children,
  centered = false
}: PropsWithChildren<{ centered?: boolean }>) {
  return (
    <Text style={[styles.body, centered && styles.centered]}>{children}</Text>
  );
}

export function Button({
  label,
  onPress,
  hint,
  disabled = false,
  selected = false,
  variant = "secondary"
}: {
  label: string;
  onPress: () => void;
  hint?: string;
  disabled?: boolean;
  selected?: boolean;
  variant?: "primary" | "secondary";
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ selected, ...(disabled ? { disabled } : {}) }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        (variant === "primary" || selected) && styles.buttonPrimary,
        selected && styles.buttonSelected,
        (pressed || disabled) && styles.pressed
      ]}
    >
      <Text
        style={[
          styles.buttonText,
          (variant === "primary" || selected) && styles.buttonTextPrimary
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function Screen({
  title,
  children,
  back = false,
  appearance = "standard"
}: PropsWithChildren<{
  title: string;
  back?: boolean;
  appearance?: "standard" | "welcome";
}>) {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          appearance === "welcome" && styles.welcomeContent
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <ScreenDecoration prominent={appearance === "welcome"} />
        {back && (
          <Button
            label="Back to dashboard"
            onPress={() => router.dismissTo("/")}
          />
        )}
        {appearance === "welcome" && (
          <Text style={styles.brand}>POCKETLEDGER</Text>
        )}
        <Text
          accessibilityRole="header"
          accessibilityLabel={`${title} screen`}
          style={[
            styles.heading,
            appearance === "welcome" && styles.welcomeHeading
          ]}
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
    paddingTop: 48,
    paddingBottom: 96,
    gap: theme.space.md,
    width: "100%",
    maxWidth: 640,
    alignSelf: "center"
  },
  welcomeContent: { maxWidth: 440, paddingTop: 164, paddingBottom: 164 },
  welcomeHeading: { textAlign: "center", fontSize: 34, fontWeight: "800" },
  brand: {
    color: theme.color.muted,
    textAlign: "center",
    fontSize: 12,
    letterSpacing: 2,
    fontWeight: "700"
  },
  centered: { textAlign: "center" },
  heading: {
    color: theme.color.primary,
    fontSize: theme.font.heading,
    fontWeight: "700"
  },
  body: { color: theme.color.text, fontSize: theme.font.body, lineHeight: 24 },
  button: {
    backgroundColor: theme.color.primarySoft,
    borderColor: theme.color.softBorder,
    borderWidth: 1,
    borderRadius: theme.pillRadius,
    minHeight: theme.touchTarget,
    padding: theme.space.md,
    alignItems: "center",
    justifyContent: "center"
  },
  buttonPrimary: {
    backgroundColor: theme.color.primary,
    borderColor: theme.color.primary
  },
  buttonSelected: { borderColor: theme.color.accent, borderWidth: 2 },
  pressed: { opacity: 0.8 },
  buttonText: {
    color: theme.color.primary,
    fontSize: theme.font.body,
    fontWeight: "600",
    textAlign: "center"
  },
  buttonTextPrimary: { color: theme.color.onPrimary },
  link: {
    color: theme.color.primary,
    backgroundColor: theme.color.surface,
    fontSize: theme.font.body,
    fontWeight: "600",
    borderWidth: 1,
    borderColor: theme.color.softBorder,
    minHeight: theme.touchTarget,
    padding: theme.space.md,
    borderRadius: theme.pillRadius
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
    borderRadius: theme.pillRadius,
    paddingHorizontal: 20
  },
  notice: {
    backgroundColor: theme.color.surface,
    padding: theme.space.md,
    borderRadius: theme.radius,
    gap: theme.space.md,
    borderWidth: 1,
    borderColor: theme.color.softBorder
  },
  noticeTitle: {
    color: theme.color.text,
    fontSize: theme.font.body,
    fontWeight: "700",
    marginBottom: theme.space.sm
  },
  error: { color: theme.color.error }
});
