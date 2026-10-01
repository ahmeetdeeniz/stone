import { getApps } from "@react-native-firebase/app";
import { AuthError } from "@stone/domain";

/**
 * React Native Firebase initialises the default app natively from
 * google-services.json / GoogleService-Info.plist, so the native app is the
 * only source of truth. Throws a readable error when the native config was not
 * bundled into this build.
 */
export function assertFirebaseConfigured(): void {
  if (getApps().length === 0) {
    throw new AuthError(
      "Firebase native config is missing. Add google-services.json / GoogleService-Info.plist and rebuild.",
    );
  }
}
