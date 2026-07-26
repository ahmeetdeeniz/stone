import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const workspaceRoot = path.resolve(import.meta.dirname, "..");
const mobileRoot = path.join(workspaceRoot, "apps", "mobile");
const rootPackage = readJson(path.join(workspaceRoot, "package.json"));
const mobilePackage = readJson(path.join(mobileRoot, "package.json"));
const easConfig = readJson(path.join(mobileRoot, "eas.json"));

assert(mobilePackage.name === "@stone/mobile", "EAS app root must be apps/mobile.");
const androidEasScript = rootPackage.scripts?.["eas:android:development"];
assert(
  androidEasScript?.includes("--dir apps/mobile"),
  "The root Android EAS wrapper must invoke EAS from apps/mobile.",
);
assert(
  androidEasScript?.includes("--platform android") &&
    androidEasScript?.includes("--profile development"),
  "The root Android EAS wrapper must select the development Android profile.",
);
assert(
  mobilePackage.dependencies?.["expo-document-picker"] === "~14.0.8",
  "expo-document-picker must be a mobile workspace dependency.",
);
assert(
  mobilePackage.dependencies?.["react-native-webview"] === "13.15.0",
  "react-native-webview must be a mobile workspace dependency.",
);
assert(
  easConfig.build?.development?.developmentClient === true,
  "Development Client is not enabled.",
);
assert(
  easConfig.build?.development?.distribution === "internal",
  "The Android development profile must produce an internal Development Build.",
);

const resolvedMobileRoot = path.resolve(
  runRootPnpm([
    "--dir",
    "apps/mobile",
    "exec",
    "node",
    "-e",
    "process.stdout.write(process.cwd())",
  ]).trim(),
);
assert(
  resolvedMobileRoot === mobileRoot,
  `pnpm --dir apps/mobile resolved to ${resolvedMobileRoot}, expected ${mobileRoot}.`,
);

const expoModules = runAutolinking(["resolve", "--platform", "android", "--json"]);
const documentPicker = expoModules.modules?.find(
  (module) => module.packageName === "expo-document-picker",
);
assert(documentPicker, "Expo autolinking did not resolve expo-document-picker.");
assert(
  documentPicker.projects?.some((project) =>
    project.modules?.includes("expo.modules.documentpicker.DocumentPickerModule"),
  ),
  "Expo autolinking did not include DocumentPickerModule.",
);

const reactNativeConfig = runAutolinking([
  "react-native-config",
  "--platform",
  "android",
  "--json",
]);
const webView = reactNativeConfig.dependencies?.["react-native-webview"];
assert(
  webView?.platforms?.android,
  "React Native autolinking did not resolve react-native-webview.",
);
assert(
  webView.platforms.android.packageInstance === "new RNCWebViewPackage()",
  "React Native autolinking did not include RNCWebViewPackage.",
);
assert(
  ["newarch", "oldarch"].some((architecture) =>
    existsSync(
      path.join(
        webView.root,
        "android",
        "src",
        architecture,
        "com",
        "reactnativecommunity",
        "webview",
        "RNCWebViewModule.java",
      ),
    ),
  ),
  "react-native-webview does not contain its Android RNCWebViewModule source.",
);

verifyGeneratedAndroidAutolinking();

console.log("Native dependency wiring verified for apps/mobile Android autolinking.");
console.log("- expo-document-picker -> expo.modules.documentpicker.DocumentPickerModule");
console.log("- react-native-webview -> RNCWebViewPackage / RNCWebViewModule");
console.log("- Expo prebuild -> generated Android autolinking hooks");

function verifyGeneratedAndroidAutolinking() {
  const androidRoot = path.join(mobileRoot, "android");
  const generatedByVerifier = !existsSync(androidRoot);

  try {
    if (generatedByVerifier) {
      runPnpm(["exec", "expo", "prebuild", "--platform", "android", "--no-install"]);
    }

    const settingsGradle = readFileSync(path.join(androidRoot, "settings.gradle"), "utf8");
    const appBuildGradle = readFileSync(path.join(androidRoot, "app", "build.gradle"), "utf8");
    assert(
      settingsGradle.includes('id("expo-autolinking-settings")'),
      "Generated Android settings.gradle is missing Expo autolinking.",
    );
    assert(
      settingsGradle.includes("expoAutolinking.useExpoModules()") &&
        settingsGradle.includes("autolinkLibrariesFromCommand"),
      "Generated Android settings.gradle is missing Expo/RN module discovery hooks.",
    );
    assert(
      appBuildGradle.includes("autolinkLibrariesWithApp()"),
      "Generated Android app/build.gradle is missing React Native autolinking.",
    );
  } finally {
    if (generatedByVerifier && existsSync(androidRoot)) {
      rmSync(androidRoot, { recursive: true, force: true });
    }
  }
}

function runAutolinking(args) {
  return JSON.parse(runPnpm(["exec", "expo-modules-autolinking", ...args]).trim());
}

function runPnpm(args) {
  const command = ["pnpm", ...args].join(" ");
  const result =
    process.platform === "win32"
      ? spawnSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", command], {
          cwd: mobileRoot,
          encoding: "utf8",
        })
      : spawnSync("pnpm", args, {
          cwd: mobileRoot,
          encoding: "utf8",
        });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "Expo autolinking command failed.");
  }
  return result.stdout;
}

function runRootPnpm(args) {
  const command = ["pnpm", ...args].join(" ");
  const result =
    process.platform === "win32"
      ? spawnSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", command], {
          cwd: workspaceRoot,
          encoding: "utf8",
        })
      : spawnSync("pnpm", args, {
          cwd: workspaceRoot,
          encoding: "utf8",
        });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "pnpm workspace command failed.");
  }
  return result.stdout;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
