import fs from "node:fs";
import path from "node:path";
import type { ConfigContext, ExpoConfig } from "expo/config";

export default ({ config }: ConfigContext): ExpoConfig => {
  const iosBundleIdentifier =
    process.env.STONE_IOS_BUNDLE_IDENTIFIER ?? config.ios?.bundleIdentifier;
  const androidPackage = process.env.STONE_ANDROID_PACKAGE ?? config.android?.package;
  const googleServicesFile = process.env.GOOGLE_SERVICES_JSON
    ? path.resolve(process.env.GOOGLE_SERVICES_JSON)
    : path.join(__dirname, "google-services.json");
  const iosFirebaseFile = process.env.GOOGLE_SERVICE_INFO_PLIST
    ? path.resolve(process.env.GOOGLE_SERVICE_INFO_PLIST)
    : path.join(__dirname, "GoogleService-Info.plist");
  return {
    ...config,
    plugins: [
      ...(config.plugins ?? []),
      "expo-background-task",
      [
        "@stone/native-widgets",
        {
          ...(iosBundleIdentifier ? { iosBundleIdentifier } : {}),
          ...(process.env.STONE_IOS_APP_GROUP
            ? { appGroupIdentifier: process.env.STONE_IOS_APP_GROUP }
            : {}),
        },
      ],
    ],
    name: config.name ?? "Stone",
    slug: config.slug ?? "stone",
    android: {
      ...config.android,
      ...(androidPackage ? { package: androidPackage } : {}),
      ...(fs.existsSync(googleServicesFile)
        ? {
            googleServicesFile: process.env.GOOGLE_SERVICES_JSON
              ? googleServicesFile
              : "./google-services.json",
          }
        : {}),
    },
    ios: {
      ...config.ios,
      ...(iosBundleIdentifier ? { bundleIdentifier: iosBundleIdentifier } : {}),
      ...(fs.existsSync(iosFirebaseFile)
        ? {
            googleServicesFile: process.env.GOOGLE_SERVICE_INFO_PLIST
              ? iosFirebaseFile
              : "./GoogleService-Info.plist",
          }
        : {}),
    },
  };
};
