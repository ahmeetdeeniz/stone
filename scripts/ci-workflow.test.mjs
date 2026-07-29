import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";

const workspaceRoot = path.resolve(import.meta.dirname, "..");
const workflow = readFileSync(path.join(workspaceRoot, ".github", "workflows", "ci.yml"), "utf8");
const pinnedNdkVersion = "27.1.12297006";

describe("GitHub Actions Android toolchain", () => {
  it("resolves sdkmanager from the Android SDK and verifies the pinned NDK installation", () => {
    expect(workflow).not.toMatch(/run:\s+sdkmanager\b/u);
    expect(workflow).toContain('SDK_ROOT="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}"');
    expect(workflow).toContain('SDKMANAGER="$SDK_ROOT/cmdline-tools/latest/bin/sdkmanager"');
    expect(workflow).toContain('"$SDKMANAGER" --version');
    expect(workflow).toContain('"$SDKMANAGER" --sdk_root="$ANDROID_SDK_ROOT" "ndk;$NDK_VERSION"');
    expect(workflow).toContain('NDK_DIRECTORY="$ANDROID_SDK_ROOT/ndk/$NDK_VERSION"');
    expect(workflow).toContain(`NDK_VERSION: ${pinnedNdkVersion}`);
  });

  it("keeps the workflow NDK pin aligned with Expo's generated Gradle configuration", () => {
    const mobileRequire = createRequire(path.join(workspaceRoot, "apps", "mobile", "package.json"));
    const expoRequire = createRequire(mobileRequire.resolve("expo/package.json"));
    const prebuildConfigRoot = path.dirname(
      expoRequire.resolve("@expo/prebuild-config/package.json"),
    );
    const expoCompatPlugin = readFileSync(
      path.join(prebuildConfigRoot, "build", "plugins", "sdk52", "ReactNative77CompatPlugin.js"),
      "utf8",
    );

    expect(expoCompatPlugin).toContain(`const ndkVersion = '${pinnedNdkVersion}'`);
  });
});
