import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Database-dependent tests have their own command and CI connection.
    exclude: [...configDefaults.exclude, "tests/integration/**"],
    passWithNoTests: true
  }
});
