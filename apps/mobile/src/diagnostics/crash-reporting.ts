import * as SecureStore from "expo-secure-store";
import {
  deleteUnsentReports,
  getCrashlytics,
  setCrashlyticsCollectionEnabled,
} from "@react-native-firebase/crashlytics";
import { parseCrashReportingPreference } from "./preferences";

/** Device-level opt-in; never synced, so each device decides for itself. */
const CRASH_REPORTING_KEY = "stone.crashReporting.v1";

export async function readCrashReporting(): Promise<boolean> {
  try {
    return parseCrashReportingPreference(await SecureStore.getItemAsync(CRASH_REPORTING_KEY));
  } catch {
    return false;
  }
}

export async function setCrashReporting(enabled: boolean): Promise<void> {
  await SecureStore.setItemAsync(CRASH_REPORTING_KEY, enabled ? "on" : "off");
  await applyCrashReporting(enabled);
}

/**
 * Crashlytics collection is off by default (apps/mobile/firebase.json). Reports captured while it
 * is off stay on the device until sent, so they are deleted rather than uploaded later.
 * Builds without the native module (an older Development Build) simply skip this.
 */
export async function applyCrashReporting(enabled: boolean): Promise<void> {
  try {
    const crashlytics = getCrashlytics();
    await setCrashlyticsCollectionEnabled(crashlytics, enabled);
    if (!enabled) await deleteUnsentReports(crashlytics);
  } catch {
    // Crash reporting is optional; the app works the same without it.
  }
}
