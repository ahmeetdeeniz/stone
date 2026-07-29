const fs = require("node:fs");
const path = require("node:path");
const {
  createRunOncePlugin,
  withDangerousMod,
  withEntitlementsPlist,
  withInfoPlist,
  withXcodeProject,
} = require("expo/config-plugins");

const targetName = "StoneWidgetsExtension";
const pluginName = "@stone/native-widgets";
const pluginVersion = "0.1.0";

function identifiers(config, options = {}) {
  const hostBundleIdentifier = options.iosBundleIdentifier || config.ios?.bundleIdentifier;
  if (!hostBundleIdentifier) {
    throw new Error("Stone widgets require ios.bundleIdentifier or STONE_IOS_BUNDLE_IDENTIFIER.");
  }
  return {
    hostBundleIdentifier,
    extensionBundleIdentifier: `${hostBundleIdentifier}.widgets`,
    appGroupIdentifier: options.appGroupIdentifier || `group.${hostBundleIdentifier}.widgets`,
  };
}

function withStoneWidgets(config, options = {}) {
  const ids = identifiers(config, options);
  config = withInfoPlist(config, (result) => {
    result.modResults.StoneWidgetAppGroup = ids.appGroupIdentifier;
    result.modResults.NSSupportsLiveActivities = true;
    return result;
  });
  config = withEntitlementsPlist(config, (result) => {
    result.modResults["com.apple.security.application-groups"] = [ids.appGroupIdentifier];
    return result;
  });
  config = withDangerousMod(config, [
    "ios",
    async (result) => {
      const root = result.modRequest.projectRoot;
      const destination = path.join(root, "ios", targetName);
      fs.mkdirSync(destination, { recursive: true });
      const source = path.join(__dirname, "ios", "Extension");
      for (const name of fs.readdirSync(source)) {
        fs.copyFileSync(path.join(source, name), path.join(destination, name));
      }
      fs.writeFileSync(
        path.join(destination, `${targetName}-Info.plist`),
        extensionInfoPlist(ids.appGroupIdentifier),
      );
      fs.writeFileSync(
        path.join(destination, `${targetName}.entitlements`),
        entitlementsPlist(ids.appGroupIdentifier),
      );
      return result;
    },
  ]);
  config = withXcodeProject(config, (result) => {
    ensureXcodeTarget(result.modResults, ids.extensionBundleIdentifier);
    return result;
  });
  config.extra = {
    ...config.extra,
    eas: {
      ...config.extra?.eas,
      build: {
        ...config.extra?.eas?.build,
        experimental: {
          ...config.extra?.eas?.build?.experimental,
          ios: {
            ...config.extra?.eas?.build?.experimental?.ios,
            appExtensions: [
              {
                targetName,
                bundleIdentifier: ids.extensionBundleIdentifier,
                entitlements: {
                  "com.apple.security.application-groups": [ids.appGroupIdentifier],
                },
              },
            ],
          },
        },
      },
    },
  };
  return config;
}

function ensureXcodeTarget(project, bundleIdentifier) {
  const targets = project.pbxNativeTargetSection();
  const existing = Object.values(targets).some(
    (value) =>
      value &&
      typeof value === "object" &&
      String(value.name || "").replaceAll('"', "") === targetName,
  );
  if (existing) return;
  const target = project.addTarget(targetName, "app_extension", targetName, bundleIdentifier);
  project.addBuildPhase([], "PBXSourcesBuildPhase", "Sources", target.uuid);
  const group = project.addPbxGroup([], targetName, targetName);
  for (const file of [
    "StoneWidgetModels.swift",
    "StoneWidgetStore.swift",
    "StoneWidgetIntents.swift",
    "StoneWidgets.swift",
    "StoneFocusLiveActivity.swift",
  ]) {
    project.addSourceFile(`${targetName}/${file}`, { target: target.uuid }, group.uuid);
  }
  for (const framework of [
    "WidgetKit.framework",
    "SwiftUI.framework",
    "ActivityKit.framework",
    "AppIntents.framework",
  ]) {
    project.addFramework(framework, { target: target.uuid });
  }
  const configurations = project.pbxXCBuildConfigurationSection();
  for (const value of Object.values(configurations)) {
    if (
      value &&
      typeof value === "object" &&
      value.buildSettings?.PRODUCT_BUNDLE_IDENTIFIER === `"${bundleIdentifier}"`
    ) {
      value.buildSettings.CODE_SIGN_ENTITLEMENTS = `"${targetName}/${targetName}.entitlements"`;
      value.buildSettings.IPHONEOS_DEPLOYMENT_TARGET = "16.1";
      value.buildSettings.SWIFT_VERSION = "5.9";
      value.buildSettings.TARGETED_DEVICE_FAMILY = '"1,2"';
      value.buildSettings.APPLICATION_EXTENSION_API_ONLY = "YES";
    }
  }
}

function extensionInfoPlist(appGroupIdentifier) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleDisplayName</key><string>Stone Widgets</string>
  <key>CFBundleExecutable</key><string>$(EXECUTABLE_NAME)</string>
  <key>CFBundleIdentifier</key><string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleName</key><string>$(PRODUCT_NAME)</string>
  <key>CFBundlePackageType</key><string>XPC!</string>
  <key>CFBundleShortVersionString</key><string>$(MARKETING_VERSION)</string>
  <key>CFBundleVersion</key><string>$(CURRENT_PROJECT_VERSION)</string>
  <key>NSExtension</key><dict>
    <key>NSExtensionPointIdentifier</key><string>com.apple.widgetkit-extension</string>
  </dict>
  <key>StoneWidgetAppGroup</key><string>${appGroupIdentifier}</string>
</dict></plist>
`;
}

function entitlementsPlist(appGroupIdentifier) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>com.apple.security.application-groups</key>
  <array><string>${appGroupIdentifier}</string></array>
</dict></plist>
`;
}

module.exports = createRunOncePlugin(withStoneWidgets, pluginName, pluginVersion);
module.exports.withStoneWidgets = withStoneWidgets;
module.exports.identifiers = identifiers;
module.exports.ensureXcodeTarget = ensureXcodeTarget;
