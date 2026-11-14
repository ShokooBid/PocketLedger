import { useRef, useState, type ComponentRef } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets
} from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { z } from "zod";
import { ClientFailure, failureMessage } from "../auth/transport";
import { useSession } from "../session";
import { StateNotice } from "../ui";
import {
  GoogleMark,
  SignInBanner,
  SignInIcon,
  WalletIllustration,
  WalletMark
} from "../sign-in-artwork";
import { theme } from "../theme";

export default function SignInScreen() {
  const { session, controller, enterDemo } = useSession();
  const [notice, setNotice] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [focused, setFocused] = useState<"email" | "password" | null>(null);
  const passwordInput = useRef<ComponentRef<typeof TextInput>>(null);
  const { height } = useWindowDimensions();
  const compact = height < 740;
  const insets = useSafeAreaInsets();
  const locked = useRef(false);
  const configured = Platform.OS !== "web" && !!process.env.EXPO_PUBLIC_API_URL;

  async function submit(method: "login" | "register" | "google") {
    if (locked.current) return;
    setNotice(null);
    if (
      method !== "google" &&
      (!z.email().max(254).safeParse(email.trim()).success ||
        password.length < (method === "register" ? 12 : 1) ||
        password.length > 128 ||
        !/\S/.test(password))
    ) {
      setNotice(failureMessage(new ClientFailure("validation")));
      return;
    }
    locked.current = true;
    setBusy(true);
    const secret = password;
    setPassword("");
    setPasswordVisible(false);
    try {
      await controller.signIn(method, email, secret);
    } catch (error) {
      setNotice(failureMessage(error));
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.surface} edges={["left", "right", "bottom"]}>
      <StatusBar style="light" />
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        keyboardDismissMode="on-drag"
      >
        <View style={styles.card}>
          <View
            style={[
              styles.banner,
              { height: insets.top + (compact ? 76 : 84) }
            ]}
          >
            <View style={StyleSheet.absoluteFill} pointerEvents="none">
              <SignInBanner />
            </View>
            <View style={[styles.brand, { paddingTop: insets.top + 12 }]}>
              <WalletMark />
              <Text style={styles.brandName}>PocketFinance</Text>
            </View>
          </View>
          <View style={[styles.content, compact && styles.compactContent]}>
            <View style={styles.hero}>
              <WalletIllustration size={compact ? 82 : 96} />
              <Text
                accessibilityRole="header"
                accessibilityLabel="Sign in screen"
                style={[styles.title, compact && styles.compactTitle]}
              >
                Sign In
              </Text>
              <Text style={styles.subtitle}>
                Track income, spending, and your monthly summary.
              </Text>
            </View>
            {session.status === "signed-out" && session.notice && (
              <Text accessibilityLiveRegion="polite" style={styles.feedback}>
                {session.notice}
              </Text>
            )}
            <View
              style={[
                styles.inputRow,
                focused === "email" && styles.inputFocused
              ]}
            >
              <SignInIcon kind="email" />
              <TextInput
                accessibilityLabel="Email address"
                placeholder="Email address"
                placeholderTextColor={theme.color.muted}
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                editable={configured && !busy}
                maxLength={254}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                autoComplete="off"
                returnKeyType="next"
                onFocus={() => setFocused("email")}
                onBlur={() => setFocused(null)}
                onSubmitEditing={() => passwordInput.current?.focus()}
              />
            </View>
            <View
              style={[
                styles.inputRow,
                focused === "password" && styles.inputFocused
              ]}
            >
              <SignInIcon kind="lock" />
              <TextInput
                ref={passwordInput}
                accessibilityLabel="Password"
                placeholder="Password"
                placeholderTextColor={theme.color.muted}
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                editable={configured && !busy}
                maxLength={128}
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                secureTextEntry={!passwordVisible}
                autoComplete="off"
                returnKeyType="go"
                onFocus={() => setFocused("password")}
                onBlur={() => setFocused(null)}
                onSubmitEditing={() => {
                  if (configured && !busy) void submit("login");
                }}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  passwordVisible ? "Hide password" : "Show password"
                }
                accessibilityState={{
                  selected: passwordVisible,
                  disabled: busy
                }}
                disabled={busy}
                onPress={() => setPasswordVisible((visible) => !visible)}
                style={styles.eye}
              >
                <SignInIcon kind={passwordVisible ? "eye-off" : "eye"} />
              </Pressable>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Sign in with email"
              accessibilityState={{ disabled: !configured || busy, busy }}
              disabled={!configured || busy}
              onPress={() => {
                void submit("login");
              }}
              style={({ pressed }) => [
                styles.submit,
                pressed && styles.pressed,
                (!configured || busy) && styles.disabled
              ]}
            >
              {busy && (
                <ActivityIndicator
                  accessible={false}
                  color={theme.color.onPrimary}
                />
              )}
              <Text style={styles.submitText}>
                {busy ? "Signing in…" : "Sign in"}
              </Text>
            </Pressable>
            <View style={styles.divider}>
              <View style={styles.rule} />
              <Text style={styles.or}>or</Text>
              <View style={styles.rule} />
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Continue with Google"
              accessibilityState={{ disabled: !configured || busy }}
              disabled={!configured || busy}
              onPress={() => {
                void submit("google");
              }}
              style={({ pressed }) => [
                styles.google,
                pressed && styles.pressed,
                (!configured || busy) && styles.disabled
              ]}
            >
              <GoogleMark />
              <Text style={styles.googleText}>Continue with Google</Text>
            </Pressable>
            <View style={styles.register}>
              <Text style={styles.registerPrompt}>Don’t have an account?</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Create account with email"
                accessibilityState={{ disabled: !configured || busy }}
                disabled={!configured || busy}
                onPress={() => {
                  void submit("register");
                }}
                style={({ pressed }) => [
                  styles.linkTarget,
                  pressed && styles.pressed,
                  (!configured || busy) && styles.disabled
                ]}
              >
                <Text style={styles.link}>Create account</Text>
              </Pressable>
            </View>
            {notice && (
              <StateNotice
                kind="error"
                title="Sign-in unavailable"
                message={notice}
              />
            )}
            {busy && (
              <StateNotice
                kind="loading"
                title="Signing in"
                message="Please wait while your session is verified."
              />
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Explore demo screens without signing in"
              accessibilityHint="Explore the app without creating an account."
              accessibilityState={{ disabled: busy }}
              onPress={enterDemo}
              disabled={busy}
              style={styles.demo}
            >
              <Text style={styles.demoText}>Explore demo</Text>
            </Pressable>
            {!configured && (
              <Text style={styles.previewNotice}>
                Sign-in isn’t available in this preview. You can explore the
                demo above.
              </Text>
            )}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  surface: { flex: 1, backgroundColor: "#F4EDFF" },
  scroll: { flexGrow: 1 },
  card: {
    width: "100%",
    maxWidth: 480,
    alignSelf: "center",
    flexGrow: 1,
    backgroundColor: "#FCF9FF",
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
    overflow: "hidden"
  },
  banner: { width: "100%" },
  brand: {
    flexDirection: "row",
    gap: 10,
    justifyContent: "center",
    alignItems: "center"
  },
  brandName: { color: "#FFF", fontSize: 25, fontWeight: "700" },
  content: { paddingHorizontal: 24, paddingTop: 4, paddingBottom: 24, gap: 12 },
  compactContent: { paddingTop: 0, gap: 10 },
  hero: { alignItems: "center", marginTop: -4, marginBottom: 10, gap: 6 },
  title: {
    color: "#542185",
    fontSize: 36,
    fontWeight: "800",
    textAlign: "center"
  },
  compactTitle: { fontSize: 32 },
  subtitle: {
    color: theme.color.text,
    fontSize: 16,
    lineHeight: 23,
    textAlign: "center",
    maxWidth: 310
  },
  inputRow: {
    minHeight: 54,
    paddingLeft: 16,
    paddingRight: 4,
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: 18
  },
  inputFocused: { borderColor: theme.color.primary },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: 52,
    paddingVertical: 14,
    paddingHorizontal: 0,
    color: theme.color.text,
    fontSize: 16
  },
  eye: {
    minWidth: 48,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center"
  },
  submit: {
    marginTop: 8,
    minHeight: 52,
    padding: 12,
    borderRadius: theme.pillRadius,
    backgroundColor: "#8442D4",
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
    justifyContent: "center"
  },
  submitText: { color: "#FFF", fontSize: 18, fontWeight: "700" },
  divider: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    alignSelf: "center",
    width: "76%",
    marginVertical: 2
  },
  rule: { flex: 1, height: 1, backgroundColor: theme.color.softBorder },
  or: { fontSize: 16, color: theme.color.muted },
  google: {
    minHeight: 52,
    padding: 12,
    borderRadius: theme.pillRadius,
    borderWidth: 1,
    borderColor: theme.color.softBorder,
    backgroundColor: "#F1E8FC",
    flexDirection: "row",
    gap: 14,
    alignItems: "center",
    justifyContent: "center"
  },
  googleText: {
    color: "#4E2874",
    fontSize: 17,
    fontWeight: "600",
    flexShrink: 1,
    textAlign: "center"
  },
  register: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    alignItems: "center",
    justifyContent: "center"
  },
  registerPrompt: { color: theme.color.text, fontSize: 14 },
  linkTarget: { minHeight: 48, paddingHorizontal: 2, justifyContent: "center" },
  link: { color: "#6F2BB9", fontWeight: "700", fontSize: 14 },
  demo: { minHeight: 48, alignItems: "center", justifyContent: "center" },
  demoText: { fontSize: 14, color: theme.color.primary, fontWeight: "600" },
  previewNotice: {
    fontSize: 13,
    lineHeight: 19,
    color: theme.color.muted,
    textAlign: "center"
  },
  feedback: {
    color: theme.color.text,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center"
  },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.65 }
});
