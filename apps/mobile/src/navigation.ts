import { type Href } from "expo-router";

export type PreviewState = "loading" | "empty" | "error";
export type PlaceholderPath =
  "/" | "/transactions" | "/categories" | "/import" | "/settings";

// Router generates path types; this helper adds our narrower query contract.
export function previewHref(pathname: PlaceholderPath, state: PreviewState) {
  return { pathname, params: { state } } satisfies Href;
}

// Deep links come from outside TypeScript. Never trust a generic type assertion
// on useLocalSearchParams as runtime validation.
export function parsePreviewState(value: unknown): PreviewState | null {
  if (value === undefined) return "empty";
  if (value === "loading" || value === "empty" || value === "error")
    return value;
  return null;
}
