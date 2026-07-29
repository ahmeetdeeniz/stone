import { NativeModules, Platform } from "react-native";
import {
  parseWidgetActionQueue,
  type WidgetActionQueue,
  type WidgetSnapshot,
} from "@stone/widgets";

interface StoneWidgetsNativeModule {
  writeSnapshot(payload: string): Promise<void>;
  readActions(): Promise<string>;
  acknowledgeActions(actionIds: readonly string[]): Promise<void>;
  clearAll(): Promise<void>;
  refreshAll(): Promise<void>;
  reconcileFocusActivity(payload: string | null): Promise<void>;
}

const module = NativeModules.StoneWidgets as StoneWidgetsNativeModule | undefined;

export const nativeWidgetsAvailable = Platform.OS === "android" || Platform.OS === "ios";

export async function writeNativeWidgetSnapshot(snapshot: WidgetSnapshot): Promise<void> {
  if (!module) return;
  await module.writeSnapshot(JSON.stringify(snapshot));
  await module.refreshAll();
  await module.reconcileFocusActivity(snapshot.focus ? JSON.stringify(snapshot.focus) : null);
}

export async function readNativeWidgetActions(): Promise<WidgetActionQueue> {
  if (!module) return { schemaVersion: 1, actions: [] };
  return parseWidgetActionQueue(JSON.parse(await module.readActions()) as unknown);
}

export async function acknowledgeNativeWidgetActions(actionIds: readonly string[]): Promise<void> {
  if (module && actionIds.length) await module.acknowledgeActions(actionIds);
}

export async function clearNativeWidgetData(): Promise<void> {
  if (module) await module.clearAll();
}
