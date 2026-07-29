import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  isSyntheticFirebaseConfigRoot,
  readSyntheticAndroidConfig,
  withSyntheticFirebaseNativeConfig,
} from "./firebase-native-verification.mjs";

const androidPackage = "com.imtempra.stone";
const iosBundleIdentifier = "com.imtempra.stone";

describe("Firebase native verification fixtures", () => {
  it("creates demo-only configs that match the configured application identifiers", () => {
    let temporaryRoot;
    withSyntheticFirebaseNativeConfig(
      { androidPackage, iosBundleIdentifier },
      ({ androidFile, iosFile, environment, temporaryRoot: root }) => {
        temporaryRoot = root;
        const androidConfig = readSyntheticAndroidConfig(androidFile);

        expect(isSyntheticFirebaseConfigRoot(root)).toBe(true);
        expect(environment).toEqual({
          GOOGLE_SERVICES_JSON: androidFile,
          GOOGLE_SERVICE_INFO_PLIST: iosFile,
        });
        expect(androidConfig.client[0].client_info.android_client_info.package_name).toBe(
          androidPackage,
        );
        expect(androidConfig.project_info.project_id).toBe("demo-stone-native-verification");
        expect(androidConfig.client[0].api_key[0].current_key).toBe(
          "verification-only-not-a-real-api-key",
        );
      },
    );

    expect(existsSync(temporaryRoot)).toBe(false);
  });

  it("cleans up after a child-operation failure", () => {
    let temporaryRoot;

    expect(() =>
      withSyntheticFirebaseNativeConfig(
        { androidPackage, iosBundleIdentifier },
        ({ temporaryRoot: root }) => {
          temporaryRoot = root;
          throw new Error("intentional child failure");
        },
      ),
    ).toThrow("intentional child failure");
    expect(existsSync(temporaryRoot)).toBe(false);
  });

  it("rejects malformed identifiers before creating a fixture", () => {
    expect(() =>
      withSyntheticFirebaseNativeConfig(
        { androidPackage: "../owner/google-services.json", iosBundleIdentifier },
        () => undefined,
      ),
    ).toThrow("Android package");
  });

  it("does not require tracked Firebase native files", () => {
    const workspaceRoot = path.resolve(import.meta.dirname, "..");
    const result = spawnSync(
      "git",
      ["ls-files", "*/google-services.json", "*/GoogleService-Info.plist"],
      { cwd: workspaceRoot, encoding: "utf8" },
    );

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("");
  });
});
