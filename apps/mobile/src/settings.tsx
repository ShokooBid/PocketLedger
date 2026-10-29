import { useEffect, useRef, useState } from "react";
import { Text } from "react-native";
import { Body, Button, Field, StateNotice } from "./ui";
import type { User } from "./auth/contracts";
import type { SessionController } from "./auth/session-controller";
import { ClientFailure } from "./auth/transport";
import { currencyExponents, type Currency } from "./transaction-data";

export function Settings({
  user,
  controller,
  defaultCurrency,
  setDefaultCurrency,
  version,
  onPrivacy,
  onExitDemo
}: {
  user: User | null;
  controller: Pick<
    SessionController,
    "linkGoogle" | "refreshAccount" | "logout"
  >;
  defaultCurrency: Currency;
  setDefaultCurrency: (currency: Currency) => void;
  version: string;
  onPrivacy: () => void;
  onExitDemo: () => void;
}) {
  const [linking, setLinking] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [needsReload, setNeedsReload] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function act(operation: "reload" | "link" | "logout" | "logout-all") {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      if (operation === "link") {
        const enteredPassword = password;
        setPassword("");
        const result = await controller.linkGoogle(enteredPassword);
        if (!mounted.current) return;
        setLinking(false);
        setMessage(
          result === "linked"
            ? "Google linked. Your account and ledger are unchanged."
            : "Google linking was cancelled. No new login method was confirmed."
        );
      } else if (operation === "reload") {
        await controller.refreshAccount();
        if (!mounted.current) return;
        setNeedsReload(false);
        setMessage("Account status updated.");
      } else {
        await controller.logout(operation === "logout-all");
      }
    } catch (failure) {
      if (!mounted.current) return;
      if (operation === "link") {
        setPassword("");
        const uncertain =
          !(failure instanceof ClientFailure) ||
          ["network", "server", "protocol", "ambiguous"].includes(failure.kind);
        setNeedsReload(uncertain);
        setError(
          uncertain
            ? "The link result could not be confirmed. Reload account status before deciding whether to try again. No proof is retried automatically."
            : failure instanceof ClientFailure &&
                failure.kind === "configuration"
              ? "Google linking is unavailable in this build. Use a configured native development build."
              : "Account proof was not accepted or Google was unavailable. Check your password and try again with a fresh Google selection."
        );
      } else
        setError(
          "Account status could not be updated. Check your connection and try again."
        );
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  let timezone = "Device timezone";
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || timezone;
  } catch {
    /* Read-only device policy still applies. */
  }
  return (
    <>
      {user ? (
        <>
          <Body>Signed in as {user.email}</Body>
          <Body>
            Email/password:{" "}
            {user.methods.password ? "available" : "not configured"}
          </Body>
          <Body>Google: {user.methods.google ? "linked" : "not linked"}</Body>
          <Button
            label="Reload account status"
            disabled={busy}
            onPress={() => void act("reload")}
          />
          {user.methods.password && !user.methods.google && (
            <>
              <Button
                label="Link Google"
                disabled={busy || needsReload}
                onPress={() => {
                  setLinking(true);
                  setError(null);
                  setMessage(null);
                }}
              />
              {linking && (
                <>
                  <Body>
                    Re-enter this account's password, then choose the Google
                    identity you want to link. Matching email addresses never
                    merge accounts. Your user ID and ledger stay the same.
                  </Body>
                  <Field
                    label="Current PocketLedger password"
                    value={password}
                    secureTextEntry
                    autoCapitalize="none"
                    autoCorrect={false}
                    maxLength={128}
                    editable={!busy && !needsReload}
                    onChangeText={setPassword}
                  />
                  <Button
                    label="Verify password and choose Google account"
                    disabled={busy || needsReload || !password.length}
                    onPress={() => void act("link")}
                  />
                  <Button
                    label="Cancel linking"
                    disabled={busy}
                    onPress={() => {
                      setPassword("");
                      setLinking(false);
                    }}
                  />
                </>
              )}
            </>
          )}
          <Body>
            Provider unlinking, password creation for Google-only accounts, and
            password recovery are not available in this MVP.
          </Body>
        </>
      ) : (
        <Body>
          Demo only — no account is connected. Preferences and transactions are
          temporary. No API authentication or support request is created.
        </Body>
      )}
      {busy && (
        <StateNotice
          kind="loading"
          title="Updating account controls"
          message="Please wait."
        />
      )}
      {error && (
        <StateNotice
          kind="error"
          title="Account action needs attention"
          message={error}
        />
      )}
      {message && <Body>{message}</Body>}
      <Body>Default currency: {defaultCurrency}</Body>
      <Body>
        This default applies to the dashboard and new transactions during this
        app session. It resets to USD when you leave the session or restart.
        Existing transactions keep their currency.
      </Body>
      {(Object.keys(currencyExponents) as Currency[]).map((currency) => (
        <Button
          key={currency}
          label={`Default currency ${currency}`}
          selected={currency === defaultCurrency}
          disabled={busy}
          onPress={() => setDefaultCurrency(currency)}
        />
      ))}
      <Body>Calendar timezone: {timezone}</Body>
      <Body>
        The app uses your device calendar when choosing today's date or current
        month. Saved accounting dates never shift with timezone or
        daylight-saving changes. There is no separate account timezone setting.
      </Body>
      <Body>App version: {version}</Body>
      <Button label="Privacy and data retention" onPress={onPrivacy} />
      <DeletionInstructions />
      {user ? (
        <>
          <Button
            label="Sign out"
            disabled={busy}
            onPress={() => void act("logout")}
          />
          <Button
            label="Sign out on all devices"
            disabled={busy}
            onPress={() => setConfirmAll(true)}
          />
          {confirmAll && (
            <>
              <Body>
                This revokes all PocketLedger sessions for this account,
                including this device. It does not delete your account or
                ledger.
              </Body>
              <Button
                label="Confirm sign out on all devices"
                disabled={busy}
                onPress={() => void act("logout-all")}
              />
              <Button
                label="Cancel all-device sign out"
                disabled={busy}
                onPress={() => setConfirmAll(false)}
              />
            </>
          )}
        </>
      ) : (
        <Button label="Exit demo and return to sign in" onPress={onExitDemo} />
      )}
    </>
  );
}

export function DeletionInstructions() {
  return (
    <>
      <Body>Request account deletion</Body>
      <Body>
        Contact the maintainer manually from your account email. Subject:
        PocketLedger account deletion request. Support must verify account
        ownership before processing. Do not include passwords, tokens or
        transaction attachments.
      </Body>
      <Text
        selectable
        accessibilityLabel="Deletion support email: shk.bidmeshki@gmail.com"
      >
        shk.bidmeshki@gmail.com
      </Text>
      <Body>
        No email is sent or drafted here. No data is deleted by these controls.
        A support response target has not been established. This pre-release
        service is intended for synthetic test data.
      </Body>
    </>
  );
}

export function PrivacyInformation() {
  return (
    <>
      <Body>
        PocketLedger is a pre-release learning MVP. Use synthetic records while
        release safeguards are being verified.
      </Body>
      <Body>
        Account identity, categories and transactions are stored on the
        PocketLedger server. Passwords are stored as adaptive hashes; the server
        stores only hashes of refresh tokens. A signed-in native device stores
        usable session credentials in platform secure storage. Finance responses
        stay in app memory; this app does not persist a dashboard or ledger
        cache.
      </Body>
      <Body>
        Google is used for identity proof only. PocketLedger does not request
        banking or financial-data access from Google. It does not connect to
        banks. It contains no AI finance processing, advertising SDK or app
        analytics integration.
      </Body>
      <Body>
        Production communication requires HTTPS. Local Android development can
        explicitly allow private-network HTTP. Hosting operators can access
        server data; this is not end-to-end encryption, a regulatory
        certification or a bank-grade security guarantee.
      </Body>
      <Body>
        Account and ledger records have no automatic retention expiry in this
        MVP. Signing out does not delete server records. Remote session
        revocation is confirmed only after a successful server response. Manual
        deletion requires verified support handling. Backup retention, deletion
        timelines and production restore procedures are not established yet; do
        not assume immediate erasure from backups.
      </Body>
      <Body>
        Consumed refresh-token hashes remain for replay detection while a
        session family is usable. The explicit server maintenance command
        removes unusable session families and expired challenges; it is not an
        automatic account-deletion service. Routine API logs exclude financial
        payloads and credentials. Operational log retention is not yet defined.
      </Body>
      <DeletionInstructions />
    </>
  );
}
