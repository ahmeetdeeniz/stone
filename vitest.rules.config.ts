import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["firebase/**/*.integration.test.ts"],
    passWithNoTests: false,
  },
});
