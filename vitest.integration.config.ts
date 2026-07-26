import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/**/src/**/*.integration.test.ts",
      "apps/mobile/src/**/*.integration.test.ts",
    ],
    passWithNoTests: false,
  },
});
