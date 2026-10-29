import { useState } from "react";
import { useSession } from "../../session";
import { Button, Screen } from "../../ui";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { usePreferences } from "../../preferences";
import { Settings } from "../../settings";

export { ErrorBoundary } from "../../error-boundary";

export default function SettingsScreen() {
  const { session, controller, exitDemo } = useSession();
  const [shouldFail, setShouldFail] = useState(false);
  const preferences = usePreferences();
  const router = useRouter();
  if (shouldFail) throw new Error("Synthetic rendering failure.");
  return (
    <Screen title="Settings" back>
      <Settings
        user={session.status === "authenticated" ? session.user : null}
        controller={controller}
        {...preferences}
        version={Constants.expoConfig?.version ?? "Development"}
        onPrivacy={() => router.push("/privacy")}
        onExitDemo={exitDemo}
      />
      {session.status === "demo" && (
        <Button
          label="Preview rendering error recovery"
          hint="Shows a safe error screen. Try again will reopen Settings."
          onPress={() => setShouldFail(true)}
        />
      )}
    </Screen>
  );
}
