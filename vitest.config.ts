import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/**/src/**/*.test.ts",
      "apps/mobile/src/**/*.test.ts",
      "apps/desktop/src/**/*.test.ts",
      "services/mcp/src/**/*.test.ts",
      "firebase/**/*.test.ts",
      "scripts/*.test.mjs",
    ],
    exclude: ["**/node_modules/**", "**/*.integration.test.ts"],
    passWithNoTests: false,
  },
});
