import { router, type Href } from "expo-router";
import { previewHref } from "../src/navigation";

// Compile-only assertions. This function is never run or bundled into the app.
// An unused @ts-expect-error fails tsc if route safety is accidentally lost.
export function checkNavigationTypes() {
  router.push("/transactions");
  router.push(previewHref("/categories", "loading"));
  const settings = { pathname: "/settings" } satisfies Href;
  router.push(settings);

  // @ts-expect-error: this route does not exist in the generated route map.
  router.push("/transactionz");
  // @ts-expect-error: unknown screen paths are not accepted.
  previewHref("/accounts", "empty");
  // @ts-expect-error: preview state is a closed union, not any string.
  previewHref("/transactions", "success");
  // @ts-expect-error: query values must use the expected string values.
  previewHref("/transactions", 42);
  // @ts-expect-error: a query state is required by this helper.
  previewHref("/transactions");
}
