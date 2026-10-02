import { describe, expect, it } from "vitest";
import {
  applyAppId,
  checkNativeConfig,
  desktopEnvFile,
  nextSteps,
  parseEnvFile,
  validateAppId,
  validateGithubClientId,
  validateProjectId,
  validateWebApiKey,
} from "./self-host-setup.mjs";

const key = `AIza${"x".repeat(35)}`;

function googleServices(projectId, packageName) {
  return JSON.stringify({
    project_info: { project_id: projectId },
    client: [{ client_info: { android_client_info: { package_name: packageName } } }],
  });
}

function plist(projectId, bundleId) {
  return `<plist><dict><key>PROJECT_ID</key><string>${projectId}</string><key>BUNDLE_ID</key><string>${bundleId}</string></dict></plist>`;
}

describe("self-host setup validation", () => {
  it("accepts real identifiers and explains wrong ones", () => {
    expect(validateProjectId("my-stone-123")).toBeNull();
    expect(validateProjectId("My Stone")).toMatch(/project ID/u);
    expect(validateWebApiKey(key)).toBeNull();
    expect(validateWebApiKey("secret")).toMatch(/AIza/u);
    expect(validateAppId("dev.deniz.stone")).toBeNull();
    expect(validateAppId("stone")).toMatch(/reverse-DNS/u);
    expect(validateGithubClientId("")).toBeNull();
    expect(validateGithubClientId("Ov23liAbCdEfGhIjKlMn")).toBeNull();
    expect(validateGithubClientId("short")).toMatch(/Client ID/u);
  });

  it("writes and reads the desktop env file", () => {
    const text = desktopEnvFile({ projectId: "my-stone", apiKey: key, authDomain: "" });
    expect(parseEnvFile(text)).toEqual({
      VITE_GITHUB_CLIENT_ID: "",
      VITE_FIREBASE_API_KEY: key,
      VITE_FIREBASE_PROJECT_ID: "my-stone",
      VITE_FIREBASE_AUTH_DOMAIN: "my-stone.firebaseapp.com",
    });
  });
});

describe("native Firebase file checks", () => {
  const base = { projectId: "my-stone", androidPackage: "dev.a.stone", iosBundleId: "dev.a.stone" };

  it("passes matching files", () => {
    expect(
      checkNativeConfig({
        ...base,
        googleServices: googleServices("my-stone", "dev.a.stone"),
        plist: plist("my-stone", "dev.a.stone"),
      }),
    ).toEqual([]);
  });

  it("reports missing files, wrong projects and wrong identifiers", () => {
    // The iOS file is optional; only the Android one is required.
    expect(checkNativeConfig({ ...base, googleServices: null, plist: null })).toHaveLength(1);
    const problems = checkNativeConfig({
      ...base,
      googleServices: googleServices("other", "com.example"),
      plist: plist("my-stone", "com.example"),
    });
    expect(problems.join("\n")).toMatch(/belongs to project "other"/u);
    expect(problems.join("\n")).toMatch(/no Android app "dev\.a\.stone"/u);
    expect(problems.join("\n")).toMatch(/bundle "com\.example"/u);
  });

  it("rejects malformed JSON", () => {
    expect(checkNativeConfig({ ...base, googleServices: "{", plist: null })[0]).toMatch(
      /not valid JSON/u,
    );
  });
});

describe("app identifiers and next steps", () => {
  it("applies one identifier to mobile and desktop", () => {
    const result = applyAppId(
      { expo: { ios: { supportsTablet: true }, android: { package: "old" } } },
      { identifier: "old.desktop", version: "0.1.0" },
      "dev.a.stone",
    );
    expect(result.appJson.expo.ios).toEqual({
      supportsTablet: true,
      bundleIdentifier: "dev.a.stone",
    });
    expect(result.appJson.expo.android.package).toBe("dev.a.stone");
    expect(result.tauriConf).toEqual({ identifier: "dev.a.stone.desktop", version: "0.1.0" });
  });

  it("points rules deployment at the chosen project", () => {
    const steps = nextSteps({ projectId: "my-stone", nativeProblems: [] }).join("\n");
    expect(steps).toContain("--project my-stone");
    expect(steps).not.toMatch(/download their config files/u);
  });
});
