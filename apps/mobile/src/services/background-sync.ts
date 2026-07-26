import * as BackgroundTask from "expo-background-task";
import * as TaskManager from "expo-task-manager";
import auth from "@react-native-firebase/auth";
import { createAppServices } from "./composition-root";

export const STONE_SYNC_TASK = "stone-sync-task";

TaskManager.defineTask(STONE_SYNC_TASK, async () => {
  try {
    const currentUser = auth().currentUser;
    if (!currentUser) return BackgroundTask.BackgroundTaskResult.Success;
    const services = await createAppServices();
    const result = await services.sync(currentUser.uid);
    return result.status === "error"
      ? BackgroundTask.BackgroundTaskResult.Failed
      : BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export async function registerBackgroundSync(): Promise<boolean> {
  const status = await BackgroundTask.getStatusAsync();
  if (status !== BackgroundTask.BackgroundTaskStatus.Available) return false;
  await BackgroundTask.registerTaskAsync(STONE_SYNC_TASK, { minimumInterval: 15 });
  return true;
}
