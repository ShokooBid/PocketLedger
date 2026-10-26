import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/integration/**/*.integration.ts"],
    environment: "node",
    hookTimeout: 180_000,
    testTimeout: 60_000,
    fileParallelism: false
  }
});
