import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // Tests assert on CLI output strings. Force color off in workers so runs
    // behave identically on TTYs and CI (where vitest injects FORCE_COLOR=1).
    env: { NO_COLOR: "1", FORCE_COLOR: "0" },
  },
});
