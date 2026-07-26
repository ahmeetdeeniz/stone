import Constants from "expo-constants";
import { AuthError } from "@stone/domain";

export interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

function readExtra(): Partial<FirebaseConfig> {
  const extra = Constants.expoConfig?.extra;
  return typeof extra === "object" && extra !== null ? extra : {};
}

export function getFirebaseConfig(): FirebaseConfig {
  const extra = readExtra();
  const values: FirebaseConfig = {
    apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY ?? extra.apiKey ?? "",
    authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ?? extra.authDomain ?? "",
    projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? extra.projectId ?? "",
    storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET ?? extra.storageBucket ?? "",
    messagingSenderId:
      process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? extra.messagingSenderId ?? "",
    appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID ?? extra.appId ?? "",
  };
  if (Object.values(values).some((value) => value === "")) {
    throw new AuthError("Firebase yapılandırması eksik. .env dosyasını doldurun.");
  }
  return values;
}
