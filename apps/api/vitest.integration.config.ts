import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/integration/**/*.test.ts"],
    environment: "node",
    // Migration setup runs one CLI command; some tests run two in sequence.
    hookTimeout: 180_000,
    testTimeout: 300_000,
    fileParallelism: false
  }
});
