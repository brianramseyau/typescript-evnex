import { defineConfig } from "vitest/config";

// Coverage is set to 100% per-file from the first commit — see
// foundational/PLAN.md §6.1. It is never ratcheted up later: the threshold is
// only cheap to hold when it has never been broken.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    // Pins TZ so nothing depends on the ambient zone — see vitest.setup.ts.
    setupFiles: ["./vitest.setup.ts"],
    coverage: {
      provider: "v8",
      all: true,
      include: ["src/**/*.ts"],
      exclude: [
        "dist/**",
        "test/**",
        "examples/**",
        "*.config.ts",
        "vitest.setup.ts",
      ],
      thresholds: {
        lines: 100,
        branches: 100,
        functions: 100,
        statements: 100,
        perFile: true,
      },
    },
  },
});
