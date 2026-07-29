import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nativeRoot = path.join(root, "packages", "native-widgets");
const required = [
  "android/src/main/java/expo/modules/stonewidgets/StoneWidgets.kt",
  "android/src/main/java/expo/modules/stonewidgets/StoneWidgetStore.kt",
  "android/src/main/java/expo/modules/stonewidgets/FocusNotification.kt",
  "ios/Extension/StoneWidgets.swift",
  "ios/Extension/StoneFocusLiveActivity.swift",
  "ios/Extension/StoneWidgetIntents.swift",
  "ios/StoneWidgetsModule.swift",
  "app.plugin.js",
];
for (const relative of required) await readFile(path.join(nativeRoot, relative), "utf8");

const nativeFiles = await collect(nativeRoot);
for (const file of nativeFiles) {
  if (!/\.(kt|swift|xml|cjs)$/u.test(file)) continue;
  const source = await readFile(file, "utf8");
  for (const forbidden of [
    "FirebaseFirestore",
    "FirebaseAuth",
    "GoogleService-Info",
    "google-services.json",
    "FIRFirestore",
  ]) {
    if (source.includes(forbidden))
      throw new Error(`Native widget directly references forbidden service: ${forbidden}`);
  }
  if (/DEVELOPMENT_TEAM\s*=/u.test(source))
    throw new Error("Native widget source must not contain an Apple Team ID.");
}

const androidEnglish = await readFile(
  path.join(nativeRoot, "android/src/main/res/values/strings.xml"),
  "utf8",
);
const androidTurkish = await readFile(
  path.join(nativeRoot, "android/src/main/res/values-tr/strings.xml"),
  "utf8",
);
const names = (source) =>
  [...source.matchAll(/<string name="([^"]+)"/gu)].map((match) => match[1]).sort();
if (JSON.stringify(names(androidEnglish)) !== JSON.stringify(names(androidTurkish)))
  throw new Error("Android widget English/Turkish resources are not in parity.");

const widgetSwift = await readFile(
  path.join(nativeRoot, "ios/Extension/StoneWidgets.swift"),
  "utf8",
);
for (const name of [
  "StoneTodayWidget",
  "StoneAgendaWidget",
  "StoneFocusWidget",
  "StoneQuickCaptureWidget",
]) {
  if (!widgetSwift.includes(name)) throw new Error(`iOS widget surface missing: ${name}`);
}
const liveSwift = await readFile(
  path.join(nativeRoot, "ios/Extension/StoneFocusLiveActivity.swift"),
  "utf8",
);
if (
  !liveSwift.includes("StoneFocusLiveActivity") ||
  !liveSwift.includes("DynamicIslandExpandedRegion") ||
  !liveSwift.includes("compactLeading")
)
  throw new Error("Dynamic Island presentations are incomplete.");

const storeSwift = await readFile(
  path.join(nativeRoot, "ios/Extension/StoneWidgetStore.swift"),
  "utf8",
);
const dictionaryKeys = (name) => {
  const block = storeSwift.match(
    new RegExp(`let ${name}: \\[String: String\\] = \\[([\\s\\S]*?)\\n    \\]`, "u"),
  )?.[1];
  if (!block) throw new Error(`iOS widget locale dictionary missing: ${name}`);
  return [...block.matchAll(/"([^"]+)":/gu)].map((match) => match[1]).sort();
};
if (JSON.stringify(dictionaryKeys("en")) !== JSON.stringify(dictionaryKeys("tr")))
  throw new Error("iOS widget English/Turkish rendering keys are not in parity.");

const workspaceExport = await readFile(
  path.join(root, "apps/mobile/src/infrastructure/storage/workspace-export.ts"),
  "utf8",
);
if (workspaceExport.includes("widget_snapshot") || workspaceExport.includes("WidgetSnapshot"))
  throw new Error("Device-local widget state must stay outside workspace export.");

console.log(
  `Native widget verification passed: ${required.length} required surfaces, resource parity, no direct Firebase dependency.`,
);

async function collect(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await collect(absolute)));
    else result.push(absolute);
  }
  return result;
}
