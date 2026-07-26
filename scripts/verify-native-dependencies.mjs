import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const workspaceRoot = path.resolve(import.meta.dirname, "..");
const mobileRoot = path.join(workspaceRoot, "apps", "mobile");
const mobilePackage = readJson(path.join(mobileRoot, "package.json"));
const easConfig = readJson(path.join(mobileRoot, "eas.json"));

assert(mobilePackage.name === "@stone/mobile", "EAS app root must be apps/mobile.");
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

console.log("Native dependency wiring verified for apps/mobile Android autolinking.");
console.log("- expo-document-picker -> expo.modules.documentpicker.DocumentPickerModule");
console.log("- react-native-webview -> RNCWebViewPackage / RNCWebViewModule");

function runAutolinking(args) {
  const command = ["pnpm", "exec", "expo-modules-autolinking", ...args].join(" ");
  const result =
    process.platform === "win32"
      ? spawnSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", command], {
          cwd: mobileRoot,
          encoding: "utf8",
        })
      : spawnSync("pnpm", ["exec", "expo-modules-autolinking", ...args], {
          cwd: mobileRoot,
          encoding: "utf8",
        });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "Expo autolinking command failed.");
  }
  return JSON.parse(result.stdout.trim());
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
