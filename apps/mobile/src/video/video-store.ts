import * as SecureStore from "expo-secure-store";
import {
  parseVideoItem,
  parseVideoPrefs,
  type VideoItemState,
  type VideoPrefs,
} from "./video-layout";

// Device-local on purpose: where a video floats and how far it played depends on this screen,
// not on the note, so none of it is synced.
const PREFS_KEY = "stone.video.prefs.v1";
const itemKey = (itemId: string) => `stone.video.item.v1.${itemId.replace(/[^\w.-]/gu, "_")}`;

export async function readVideoPrefs(): Promise<VideoPrefs> {
  try {
    return parseVideoPrefs(await SecureStore.getItemAsync(PREFS_KEY));
  } catch {
    return parseVideoPrefs(null);
  }
}

export async function writeVideoPrefs(prefs: VideoPrefs): Promise<void> {
  await SecureStore.setItemAsync(PREFS_KEY, JSON.stringify(prefs));
}

export async function readVideoItem(itemId: string): Promise<VideoItemState | null> {
  try {
    return parseVideoItem(await SecureStore.getItemAsync(itemKey(itemId)));
  } catch {
    return null;
  }
}

export async function writeVideoItem(itemId: string, state: VideoItemState | null): Promise<void> {
  if (state) await SecureStore.setItemAsync(itemKey(itemId), JSON.stringify(state));
  else await SecureStore.deleteItemAsync(itemKey(itemId));
}
