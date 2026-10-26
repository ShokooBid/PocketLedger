import { useRef, useState } from "react";
import { Platform } from "react-native";
import { z } from "zod";
import { ClientFailure, failureMessage } from "../auth/transport";
import { useSession } from "../session";
import { Body, Button, Field, Screen, StateNotice } from "../ui";

export default function SignInScreen() {
  const { session, controller, enterDemo } = useSession();
  const [notice, setNotice] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
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
    <Screen title="Sign in">
      <Body>Sign in to manage your PocketLedger categories.</Body>
      {!configured && (
        <Body>
          Authentication needs a configured native build. Explore the demo
          below.
        </Body>
      )}
      {session.status === "signed-out" && session.notice && (
        <Body>{session.notice}</Body>
      )}
      <Field
        label="Email address"
        placeholder="you@example.com"
        value={email}
        onChangeText={setEmail}
        editable={configured && !busy}
        maxLength={254}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        autoComplete="off"
      />
      <Field
        label="Password"
        placeholder="Password"
        value={password}
        onChangeText={setPassword}
        editable={configured && !busy}
        maxLength={128}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        secureTextEntry
        autoComplete="off"
      />
      <Button
        label="Sign in with email"
        disabled={!configured || busy}
        onPress={() => {
          void submit("login");
        }}
      />
      <Button
        label="Create account with email"
        disabled={!configured || busy}
        onPress={() => {
          void submit("register");
        }}
      />
      <Button
        label="Continue with Google"
        disabled={!configured || busy}
        onPress={() => {
          void submit("google");
        }}
      />
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
      <Button
        label="Explore demo screens without signing in"
        hint="Opens empty screen previews. This does not authenticate you."
        onPress={enterDemo}
        disabled={busy}
      />
    </Screen>
  );
}
