import { describe, expect, it } from "vitest";
import { config } from "./desktop-api";

describe("GitHub desktop boundary", () => {
  it("does not require a GitHub client secret in the desktop bundle", () => {
    expect(config).not.toHaveProperty("githubClientSecret");
  });

  it("keeps the configured OAuth client id public and separately configurable", () => {
    expect(typeof config.githubClientId).toBe("string");
  });
});
