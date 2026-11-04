import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Database-dependent tests have their own command and CI connection.
    exclude: [...configDefaults.exclude, "tests/integration/**"],
    // Bound compiler/startup contention so cold Fastify setup keeps its 5s limit.
    maxWorkers: 2,
    passWithNoTests: false
  }
});
