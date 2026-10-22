import { useState } from "react";
import { useSession } from "../session";
import { Body, Button, Field, Screen, StateNotice } from "../ui";

export default function SignInScreen() {
  const { enterDemo } = useSession();
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <Screen title="Sign in">
      <Body>PocketLedger navigation preview</Body>
      <Body>
        Sign-in is not connected. These fields are read-only placeholders; do
        not enter real credentials. No account or session will be created.
      </Body>
      <Field
        label="Email address (preview only)"
        placeholder="you@example.com"
        value=""
        editable={false}
        accessibilityHint="Read-only placeholder. Email sign-in is not available yet."
        accessibilityState={{ disabled: true }}
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="off"
      />
      <Field
        label="Password (preview only)"
        placeholder="Password"
        value=""
        editable={false}
        accessibilityHint="Read-only placeholder. No password is collected."
        accessibilityState={{ disabled: true }}
        secureTextEntry
        autoComplete="off"
      />
      <Button
        label="Sign in with email (preview only)"
        hint="Explains that email sign-in is not connected."
        onPress={() =>
          setNotice("Email and password sign-in is not connected yet.")
        }
      />
      <Button
        label="Continue with Google (preview only)"
        hint="Explains that Google sign-in is not connected."
        onPress={() => setNotice("Google sign-in is not connected yet.")}
      />
      {notice && (
        <StateNotice
          kind="empty"
          title="Preview only"
          message={`${notice} You are still signed out.`}
        />
      )}
      <Button
        label="Explore demo screens without signing in"
        hint="Opens empty screen previews. This does not authenticate you."
        onPress={enterDemo}
      />
    </Screen>
  );
}
