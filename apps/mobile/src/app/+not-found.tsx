import { Screen, StateNotice, NavigationLink } from "../ui";
import { useSession } from "../session";

export default function NotFoundScreen() {
  const { session } = useSession();
  return (
    <Screen title="Page not found">
      <StateNotice
        kind="error"
        title="This page is unavailable"
        message="Return to the start to continue exploring PocketLedger."
      />
      <NavigationLink
        href={session.status === "authenticated" ? "/" : "/sign-in"}
        label="Return to start"
      />
    </Screen>
  );
}
