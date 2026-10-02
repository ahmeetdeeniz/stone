import * as Updates from "expo-updates";
import type { UpdateCheckOutcome } from "./preferences";

export const updatesEnabled = Updates.isEnabled;

export function currentUpdate(): {
  channel: string | null;
  updateId: string | null;
  embedded: boolean;
} {
  return {
    channel: Updates.channel,
    updateId: Updates.updateId,
    embedded: Updates.isEmbeddedLaunch,
  };
}

/** Downloads a newer update for this build's channel and runtime, if there is one. */
export async function checkForAppUpdate(): Promise<UpdateCheckOutcome> {
  if (!Updates.isEnabled) return "disabled";
  const check = await Updates.checkForUpdateAsync();
  if (!check.isAvailable) return "current";
  const fetched = await Updates.fetchUpdateAsync();
  return fetched.isNew ? "downloaded" : "current";
}

export function restartIntoUpdate(): Promise<void> {
  return Updates.reloadAsync();
}
