import { useState } from "react";
import { PlaceholderScreen } from "../../placeholder-screen";
import { useSession } from "../../session";
import { Button } from "../../ui";

export { ErrorBoundary } from "../../error-boundary";

export default function SettingsScreen() {
  const { exitDemo } = useSession();
  const [shouldFail, setShouldFail] = useState(false);
  if (shouldFail) throw new Error("Synthetic rendering failure.");

  return (
    <PlaceholderScreen
      title="Settings"
      path="/settings"
      description="Account and privacy settings will appear here. PocketLedger does not connect to a bank in the MVP."
      emptyMessage="No account is connected. This demo stores no credentials or financial records."
    >
      <Button label="Exit demo and return to sign in" onPress={exitDemo} />
      <Button
        label="Preview rendering error recovery"
        hint="Shows a safe error screen. Try again will reopen Settings."
        onPress={() => setShouldFail(true)}
      />
    </PlaceholderScreen>
  );
}
