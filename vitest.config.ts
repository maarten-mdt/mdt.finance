import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": import.meta.dirname } },
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/db/**/*.test.ts"],
    // DB tests share one database; run files serially.
    fileParallelism: false,
    testTimeout: 20000,
  },
});
