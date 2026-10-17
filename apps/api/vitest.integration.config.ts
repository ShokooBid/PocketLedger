import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/integration/**/*.test.ts"],
    environment: "node",
    // Remove once the first API integration suite exists.
    passWithNoTests: true,
    fileParallelism: false
  }
});
