import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const mobileRoot = path.resolve(process.cwd(), "apps/mobile");
const nativeFilesPresent = ["google-services.json", "GoogleService-Info.plist"].every((fileName) =>
  existsSync(path.join(mobileRoot, fileName)),
);

describe.skipIf(!nativeFilesPresent)("supplied Firebase native configuration", () => {
  it("contains the platform files for the configured Stone app", () => {
    const googleServices = JSON.parse(
      readFileSync(path.join(mobileRoot, "google-services.json"), "utf8"),
    ) as {
      client?: Array<{
        client_info?: { android_client_info?: { package_name?: string } };
      }>;
    };
    const appConfig = JSON.parse(readFileSync(path.join(mobileRoot, "app.json"), "utf8")) as {
      expo: { android: { package: string }; ios: { bundleIdentifier: string } };
    };
    const plist = readFileSync(path.join(mobileRoot, "GoogleService-Info.plist"), "utf8");
    const androidPackage =
      googleServices.client?.[0]?.client_info?.android_client_info?.package_name;
    const iosBundleMatch = plist.match(/<key>BUNDLE_ID<\/key>\s*<string>([^<]+)<\/string>/);

    expect(androidPackage).toBe(appConfig.expo.android.package);
    expect(iosBundleMatch?.[1]).toBe(appConfig.expo.ios.bundleIdentifier);
    expect(plist).toContain("<key>PROJECT_ID</key>");
    expect(plist).toContain("<key>GOOGLE_APP_ID</key>");
  });
});
