import { type PropsWithChildren } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  parsePreviewState,
  previewHref,
  type PlaceholderPath
} from "./navigation";
import { Body, Button, Screen, StateNotice } from "./ui";
import { useSession } from "./session";

export function PlaceholderScreen({
  title,
  path,
  description,
  emptyMessage,
  children
}: PropsWithChildren<{
  title: string;
  path: PlaceholderPath;
  description: string;
  emptyMessage: string;
}>) {
  const { state } = useLocalSearchParams();
  const preview = parsePreviewState(state);
  const router = useRouter();
  const { session } = useSession();
  const reset = () => router.replace(previewHref(path, "empty"));

  return (
    <Screen title={title} back={path !== "/"}>
      <Body>
        {session.status === "demo"
          ? "Demo only — you are not signed in. No financial data is loaded."
          : "This screen is a preview. Categories and transactions are connected; dashboard summaries and CSV import are coming later."}
      </Body>
      <Body>{description}</Body>
      {preview === null ? (
        <StateNotice
          kind="error"
          title="Invalid preview state"
          message="Choose loading, empty, or error to preview this screen."
          onRetry={reset}
        />
      ) : (
        <StateNotice
          kind={preview}
          title={
            preview === "loading"
              ? "Loading preview"
              : preview === "error"
                ? "Error preview"
                : "Nothing here yet"
          }
          message={
            preview === "loading"
              ? "This is a loading example. No request is running; choose another preview below."
              : preview === "error"
                ? "This is an error example. Try again to return to the empty preview."
                : emptyMessage
          }
          {...(preview === "error" ? { onRetry: reset } : {})}
        />
      )}
      {children}
      <Body>Screen state previews</Body>
      {(["empty", "loading", "error"] as const).map((next) => (
        <Button
          key={next}
          label={`Preview ${next} state`}
          selected={preview === next}
          onPress={() => router.replace(previewHref(path, next))}
        />
      ))}
    </Screen>
  );
}
