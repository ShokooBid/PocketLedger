import { useRouter } from "expo-router";
import { Screen, Button } from "../../ui";
import { PrivacyInformation } from "../../settings";

export default function PrivacyScreen() {
  const router = useRouter();
  return (
    <Screen title="Privacy and data retention">
      <Button
        label="Back to Settings"
        onPress={() => {
          if (router.canGoBack()) router.back();
          else router.replace("/settings");
        }}
      />
      <PrivacyInformation />
    </Screen>
  );
}
