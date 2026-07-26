import fs from "node:fs";
import path from "node:path";
import type { ConfigContext, ExpoConfig } from "expo/config";

interface FirebasePublicConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

function readFirebasePublicConfig(filePath: string): FirebasePublicConfig | undefined {
  if (!fs.existsSync(filePath)) return undefined;

  const nativeConfig = JSON.parse(fs.readFileSync(filePath, "utf8")) as {
    project_info?: {
      project_id?: string;
      project_number?: string;
      storage_bucket?: string;
    };
    client?: Array<{
      client_info?: { mobilesdk_app_id?: string };
      api_key?: Array<{ current_key?: string }>;
    }>;
  };
  const projectInfo = nativeConfig.project_info;
  const client = nativeConfig.client?.[0];
  const projectId = projectInfo?.project_id ?? "";
  const values: FirebasePublicConfig = {
    apiKey: client?.api_key?.[0]?.current_key ?? "",
    authDomain: projectId ? `${projectId}.firebaseapp.com` : "",
    projectId,
    storageBucket: projectInfo?.storage_bucket ?? "",
    messagingSenderId: "",
    appId: client?.client_info?.mobilesdk_app_id ?? "",
  };
  const projectNumber = projectInfo?.project_number;
  values.messagingSenderId = projectNumber ?? "";

  return Object.values(values).every(Boolean) ? values : undefined;
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const googleServicesFile = process.env.GOOGLE_SERVICES_JSON
    ? path.resolve(process.env.GOOGLE_SERVICES_JSON)
    : path.join(__dirname, "google-services.json");
  const iosFirebaseFile = process.env.GOOGLE_SERVICE_INFO_PLIST
    ? path.resolve(process.env.GOOGLE_SERVICE_INFO_PLIST)
    : path.join(__dirname, "GoogleService-Info.plist");
  const firebasePublicConfig = readFirebasePublicConfig(googleServicesFile);
  return {
    ...config,
    plugins: [...(config.plugins ?? []), "expo-background-task"],
    extra: {
      ...config.extra,
      ...firebasePublicConfig,
    },
    name: config.name ?? "Stone",
    slug: config.slug ?? "stone",
    android: {
      ...config.android,
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
