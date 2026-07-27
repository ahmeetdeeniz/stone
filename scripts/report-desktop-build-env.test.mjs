import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const scriptPath = fileURLToPath(new URL("./report-desktop-build-env.mjs", import.meta.url));

const requiredKeys = [
  "VITE_FIREBASE_API_KEY",
  "VITE_FIREBASE_PROJECT_ID",
  "VITE_FIREBASE_AUTH_DOMAIN",
  "VITE_GITHUB_CLIENT_ID",
];

function run(env) {
  const result = spawnSync(process.execPath, [scriptPath], {
    env: { ...env, PATH: process.env.PATH },
    encoding: "utf8",
  });
  return result;
}

describe("report-desktop-build-env", () => {
  it("reports every key as missing and exits 0 when none are set", () => {
    const result = run({});
    expect(result.status).toBe(0);
    for (const key of requiredKeys) {
      expect(result.stdout).toContain(`${key}: missing`);
    }
    expect(result.stdout).toContain("4 of 4 desktop build variable(s) are not set");
  });

  it("reports every key as configured and never prints the actual values", () => {
    const secrets = Object.fromEntries(
      requiredKeys.map((key) => [key, `super-secret-${key.toLowerCase()}-value`]),
    );
    const result = run(secrets);
    expect(result.status).toBe(0);
    for (const key of requiredKeys) {
      expect(result.stdout).toContain(`${key}: configured`);
    }
    expect(result.stdout).toContain("All desktop build variables are configured.");
    for (const value of Object.values(secrets)) {
      expect(result.stdout).not.toContain(value);
      expect(result.stderr).not.toContain(value);
    }
  });

  it("reports a mixed configured/missing status without failing the build", () => {
    const result = run({
      VITE_FIREBASE_API_KEY: "some-value",
      VITE_GITHUB_CLIENT_ID: "another-value",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("VITE_FIREBASE_API_KEY: configured");
    expect(result.stdout).toContain("VITE_GITHUB_CLIENT_ID: configured");
    expect(result.stdout).toContain("VITE_FIREBASE_PROJECT_ID: missing");
    expect(result.stdout).toContain("VITE_FIREBASE_AUTH_DOMAIN: missing");
    expect(result.stdout).toContain("2 of 4 desktop build variable(s) are not set");
    expect(result.stdout).not.toContain("some-value");
    expect(result.stdout).not.toContain("another-value");
  });

  it("treats an empty string as not configured", () => {
    const result = run({ VITE_FIREBASE_API_KEY: "" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("VITE_FIREBASE_API_KEY: missing");
  });
});
