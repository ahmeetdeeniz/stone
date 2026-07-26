import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { requireFirebaseConfigured, resolveDesktopConfig } from "./desktop-api";

describe("desktop environment configuration", () => {
  it("reads desktop config only from VITE_* keys", () => {
    const config = resolveDesktopConfig({
      VITE_FIREBASE_API_KEY: "desktop-key",
      VITE_FIREBASE_PROJECT_ID: "desktop-project",
      VITE_FIREBASE_AUTH_DOMAIN: "desktop.firebaseapp.com",
      VITE_GITHUB_CLIENT_ID: "desktop-client-id",
    });
    expect(config).toEqual({
      firebaseApiKey: "desktop-key",
      firebaseProjectId: "desktop-project",
      firebaseAuthDomain: "desktop.firebaseapp.com",
      githubClientId: "desktop-client-id",
    });
  });

  it("never lets the mobile app's EXPO_PUBLIC_* variables populate desktop config", () => {
    const config = resolveDesktopConfig({
      EXPO_PUBLIC_FIREBASE_API_KEY: "mobile-key",
      EXPO_PUBLIC_FIREBASE_PROJECT_ID: "mobile-project",
      EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: "mobile.firebaseapp.com",
    });
    expect(config).toEqual({
      firebaseApiKey: "",
      firebaseProjectId: "",
      firebaseAuthDomain: "",
      githubClientId: "",
    });
  });

  it("falls back to empty strings for missing or non-string values", () => {
    const config = resolveDesktopConfig({ VITE_FIREBASE_API_KEY: 1234 });
    expect(config.firebaseApiKey).toBe("");
  });
});

describe("requireFirebaseConfigured", () => {
  it("throws a clear, actionable error when Firebase config is missing", () => {
    expect(() => requireFirebaseConfigured("")).toThrow(/VITE_FIREBASE_API_KEY/);
  });

  it("does not throw once a Firebase API key is configured", () => {
    expect(() => requireFirebaseConfigured("some-api-key")).not.toThrow();
  });
});

describe("desktop Vite env directory wiring", () => {
  it("resolves env files from the desktop package, not the monorepo root", () => {
    const viteConfig = readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");
    expect(viteConfig).toMatch(/envDir:\s*"\."/);
    expect(viteConfig).not.toMatch(/envDir:\s*"\.\.\/\.\./);
  });

  it("documents every VITE_* key the desktop app reads in .env.example", () => {
    const example = readFileSync(new URL("../.env.example", import.meta.url), "utf8");
    for (const key of [
      "VITE_GITHUB_CLIENT_ID",
      "VITE_FIREBASE_API_KEY",
      "VITE_FIREBASE_PROJECT_ID",
      "VITE_FIREBASE_AUTH_DOMAIN",
    ]) {
      expect(example).toMatch(new RegExp(`^${key}=`, "m"));
    }
  });
});
