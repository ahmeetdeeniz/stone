import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const demoProjectId = "demo-stone-native-verification";
const demoProjectNumber = "123456789012";
const demoAndroidAppId = `1:${demoProjectNumber}:android:0000000000000000000000`;
const demoIosAppId = `1:${demoProjectNumber}:ios:0000000000000000000000`;

export function withSyntheticFirebaseNativeConfig(
  { androidPackage, iosBundleIdentifier },
  callback,
) {
  assertApplicationIdentifier(androidPackage, "Android package");
  assertApplicationIdentifier(iosBundleIdentifier, "iOS bundle identifier");

  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "stone-firebase-native-verification-"));
  const androidFile = path.join(temporaryRoot, "google-services.json");
  const iosFile = path.join(temporaryRoot, "GoogleService-Info.plist");

  try {
    writeFileSync(
      androidFile,
      `${JSON.stringify(createAndroidConfig(androidPackage), null, 2)}\n`,
      "utf8",
    );
    writeFileSync(iosFile, createIosConfig(iosBundleIdentifier), "utf8");

    return callback({
      androidFile,
      iosFile,
      temporaryRoot,
      environment: {
        GOOGLE_SERVICES_JSON: androidFile,
        GOOGLE_SERVICE_INFO_PLIST: iosFile,
      },
    });
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

export function readSyntheticAndroidConfig(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

export function isSyntheticFirebaseConfigRoot(directory) {
  return (
    path.basename(directory).startsWith("stone-firebase-native-verification-") &&
    existsSync(directory)
  );
}

function createAndroidConfig(androidPackage) {
  return {
    project_info: {
      project_number: demoProjectNumber,
      project_id: demoProjectId,
      storage_bucket: `${demoProjectId}.firebasestorage.app`,
    },
    client: [
      {
        client_info: {
          mobilesdk_app_id: demoAndroidAppId,
          android_client_info: {
            package_name: androidPackage,
          },
        },
        oauth_client: [],
        api_key: [
          {
            current_key: "verification-only-not-a-real-api-key",
          },
        ],
        services: {
          appinvite_service: {
            other_platform_oauth_client: [],
          },
        },
      },
    ],
    configuration_version: "1",
  };
}

function createIosConfig(iosBundleIdentifier) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>API_KEY</key>
  <string>verification-only-not-a-real-api-key</string>
  <key>GCM_SENDER_ID</key>
  <string>${demoProjectNumber}</string>
  <key>PLIST_VERSION</key>
  <string>1</string>
  <key>BUNDLE_ID</key>
  <string>${escapeXml(iosBundleIdentifier)}</string>
  <key>PROJECT_ID</key>
  <string>${demoProjectId}</string>
  <key>STORAGE_BUCKET</key>
  <string>${demoProjectId}.firebasestorage.app</string>
  <key>IS_ADS_ENABLED</key>
  <false/>
  <key>IS_ANALYTICS_ENABLED</key>
  <false/>
  <key>IS_APPINVITE_ENABLED</key>
  <false/>
  <key>IS_GCM_ENABLED</key>
  <true/>
  <key>IS_SIGNIN_ENABLED</key>
  <true/>
  <key>GOOGLE_APP_ID</key>
  <string>${demoIosAppId}</string>
</dict>
</plist>
`;
}

function assertApplicationIdentifier(value, label) {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/u.test(value)
  ) {
    throw new Error(`${label} is not a valid application identifier.`);
  }
}

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
