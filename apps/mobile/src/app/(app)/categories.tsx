import { PlaceholderScreen } from "../../placeholder-screen";
import { useLocalSearchParams, useRouter } from "expo-router";
import { CategoryManagement } from "../../category-management";
import { useCategories } from "../../category-context";
import { useSession } from "../../session";
import { parsePreviewState, previewHref } from "../../navigation";
import { Body, Button, Screen } from "../../ui";

export default function CategoriesScreen() {
  const { state } = useLocalSearchParams();
  const preview = parsePreviewState(state);
  const source = useCategories();
  const { session } = useSession();
  const router = useRouter();
  if (session.status === "authenticated")
    return (
      <Screen title="Categories" back>
        <Body>
          Manage your categories. Archived categories remain available for
          history.
        </Body>
        <CategoryManagement source={source} demo={false} />
      </Screen>
    );
  if (preview === "empty")
    return (
      <Screen title="Categories" back>
        <Body>
          Demo only — you are not signed in. Categories are kept in memory,
          never sent to the API, and discarded when you exit the demo or
          restart.
        </Body>
        <CategoryManagement source={source} />
        <Body>Screen state previews</Body>
        {(["empty", "loading", "error"] as const).map((next) => (
          <Button
            key={next}
            label={`Preview ${next} state`}
            selected={preview === next}
            onPress={() => router.replace(previewHref("/categories", next))}
          />
        ))}
      </Screen>
    );
  return (
    <PlaceholderScreen
      title="Categories"
      path="/categories"
      description="Preview category screen states. No request is running."
      emptyMessage="Add your first demo category."
    />
  );
}
