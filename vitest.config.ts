import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/**/src/**/*.test.ts",
      "apps/mobile/src/design/**/*.test.ts",
      "apps/mobile/src/infrastructure/**/*.test.ts",
    ],
    exclude: ["**/*.integration.test.ts"],
    passWithNoTests: false,
  },
});
