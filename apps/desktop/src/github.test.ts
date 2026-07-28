import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { config } from "./desktop-api";

describe("GitHub desktop boundary", () => {
  it("does not require a GitHub client secret in the desktop bundle", () => {
    expect(config).not.toHaveProperty("githubClientSecret");
  });

  it("keeps the configured OAuth client id public and separately configurable", () => {
    expect(typeof config.githubClientId).toBe("string");
  });

  it("stores and removes GitHub credentials only through the native keychain boundary", () => {
    const source = readFileSync(new URL("../src-tauri/src/github.rs", import.meta.url), "utf8");
    expect(source).toContain(".set_password(&access_token)");
    expect(source).toContain(".delete_credential()");
    expect(source).not.toMatch(/println!\([^)]*access_token/);
  });
});
