import fs from "node:fs";
import path from "node:path";
import type { ConfigContext, ExpoConfig } from "expo/config";

export default ({ config }: ConfigContext): ExpoConfig => {
  const googleServicesFile = path.join(__dirname, "google-services.json");
  const iosFirebaseFile = path.join(__dirname, "GoogleService-Info.plist");
  return {
    ...config,
    name: config.name ?? "Stone",
    slug: config.slug ?? "stone",
    android: {
      ...config.android,
      ...(fs.existsSync(googleServicesFile)
        ? { googleServicesFile: "./google-services.json" }
        : {}),
    },
    ios: {
      ...config.ios,
      ...(fs.existsSync(iosFirebaseFile)
        ? { googleServicesFile: "./GoogleService-Info.plist" }
        : {}),
    },
  };
};
