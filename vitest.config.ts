import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/**/src/**/*.test.ts",
      "apps/mobile/src/**/*.test.ts",
      "services/mcp/src/**/*.test.ts",
    ],
    exclude: ["**/node_modules/**", "**/*.integration.test.ts"],
    passWithNoTests: false,
  },
});
