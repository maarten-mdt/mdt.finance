import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": import.meta.dirname,
      // "server-only" throws outside a React Server Component bundle; tests run in plain Node.
      "server-only": `${import.meta.dirname}/tests/server-only-stub.ts`,
    },
  },
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/db/**/*.test.ts"],
    // DB tests each create their own database; run files one at a time to keep it simple.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 60000,
  },
});
