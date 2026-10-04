import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import {
  DEFAULT_REMINDER_SETTINGS,
  diffReminders,
  parseReminderSettings,
  planReminders,
  REMINDER_WINDOW_DAYS,
  type PlannedReminder,
  type ReminderSettings,
} from "@stone/domain";
import type { TranslationKey, TranslationParameters } from "@stone/i18n";
import type { AppServices } from "../services/composition-root";

type Translate = (key: TranslationKey, parameters?: TranslationParameters) => string;

export const REMINDER_SETTINGS_KEY = "stone.reminders.settings.v1";
export const REMINDER_CHANNEL_ID = "stone-reminders";
export const TASK_REMINDER_CATEGORY = "stone-task-reminder";
export const REMINDER_ACTION_COMPLETE = "complete";
export const REMINDER_ACTION_SNOOZE = "snooze";
export const SNOOZE_MINUTES = 10;

/** Payload stored on every Stone reminder so pending ones can be told apart from other apps'. */
export interface ReminderData {
  stone: "reminder";
  kind: "planned" | "snooze";
  source: PlannedReminder["source"];
  targetId: string;
}

export async function readReminderSettings(): Promise<ReminderSettings> {
  try {
    const stored = await SecureStore.getItemAsync(REMINDER_SETTINGS_KEY);
    return stored ? parseReminderSettings(JSON.parse(stored)) : DEFAULT_REMINDER_SETTINGS;
  } catch {
    return DEFAULT_REMINDER_SETTINGS;
  }
}

export async function writeReminderSettings(settings: ReminderSettings): Promise<void> {
  await SecureStore.setItemAsync(REMINDER_SETTINGS_KEY, JSON.stringify(settings));
}

export async function reminderPermissionGranted(): Promise<boolean> {
  const permission = await Notifications.getPermissionsAsync();
  return permission.granted;
}

export async function requestReminderPermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  return (await Notifications.requestPermissionsAsync()).granted;
}

/** Channel, foreground presentation and the task action buttons, in the current locale. */
export async function configureReminders(t: Translate): Promise<void> {
  Notifications.setNotificationHandler({
    handleNotification: () =>
      Promise.resolve({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
  });
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync(REMINDER_CHANNEL_ID, {
      name: t("reminders.channel"),
      importance: Notifications.AndroidImportance.HIGH,
    });
  }
  // Both actions run JavaScript, so they bring the app forward; that is what makes them reliable
  // when the app was not running.
  await Notifications.setNotificationCategoryAsync(TASK_REMINDER_CATEGORY, [
    {
      identifier: REMINDER_ACTION_COMPLETE,
      buttonTitle: t("reminders.complete"),
      options: { opensAppToForeground: true },
    },
    {
      identifier: REMINDER_ACTION_SNOOZE,
      buttonTitle: t("reminders.snooze", { minutes: SNOOZE_MINUTES }),
      options: { opensAppToForeground: true },
    },
  ]);
}

/**
 * Re-plans the account's reminders and applies only the difference to the OS schedule, so it is
 * cheap to call on every foreground/background transition.
 */
export async function syncReminders(
  services: AppServices,
  ownerId: string,
  t: Translate,
  locale: string,
  now = new Date(),
): Promise<void> {
  const settings = await readReminderSettings();
  const pending = await pendingPlannedReminders();
  if (!settings.enabled || !(await reminderPermissionGranted())) {
    await Promise.all(pending.map((id) => Notifications.cancelScheduledNotificationAsync(id)));
    return;
  }
  const windowEnd = new Date(now.getTime() + (REMINDER_WINDOW_DAYS + 1) * 86_400_000);
  const [tasks, calendarItems] = await Promise.all([
    services.tasks.list(ownerId, { state: "open", limit: 2_000 }),
    services.calendar.list(ownerId, {
      startDate: now.toISOString().slice(0, 10),
      endDate: windowEnd.toISOString().slice(0, 10),
      limit: 2_000,
    }),
  ]);
  const planned = planReminders({ tasks, calendarItems, now, settings });
  const { cancel, schedule } = diffReminders(pending, planned);
  await Promise.all(cancel.map((id) => Notifications.cancelScheduledNotificationAsync(id)));
  for (const reminder of schedule) await scheduleReminder(reminder, "planned", t, locale);
}

export async function cancelAllReminders(): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((request) => isReminderData(request.content.data))
      .map((request) => Notifications.cancelScheduledNotificationAsync(request.identifier)),
  );
}

export async function snoozeReminder(
  notification: Notifications.Notification,
  now = new Date(),
): Promise<void> {
  const data = notification.request.content.data;
  if (!isReminderData(data)) return;
  await Notifications.scheduleNotificationAsync({
    identifier: `snooze:${data.source}:${data.targetId}:${now.getTime()}`,
    content: {
      title: notification.request.content.title ?? "",
      body: notification.request.content.body ?? "",
      data: { ...data, kind: "snooze" } satisfies ReminderData,
      ...(data.source === "task" ? { categoryIdentifier: TASK_REMINDER_CATEGORY } : {}),
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: new Date(now.getTime() + SNOOZE_MINUTES * 60_000),
      ...(Platform.OS === "android" ? { channelId: REMINDER_CHANNEL_ID } : {}),
    },
  });
}

export function isReminderData(value: unknown): value is ReminderData {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>).stone === "reminder" &&
    typeof (value as Record<string, unknown>).targetId === "string"
  );
}

export function reminderBody(
  reminder: Pick<PlannedReminder, "source" | "dueAt" | "allDay">,
  t: Translate,
  locale: string,
): string {
  if (reminder.allDay)
    return t(reminder.source === "task" ? "reminders.taskDueToday" : "reminders.eventToday");
  const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(
    new Date(reminder.dueAt),
  );
  return t(reminder.source === "task" ? "reminders.taskDueAt" : "reminders.eventStartsAt", {
    time,
  });
}

async function pendingPlannedReminders(): Promise<string[]> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  return scheduled
    .filter((request) => {
      const data = request.content.data;
      return isReminderData(data) && data.kind === "planned";
    })
    .map((request) => request.identifier);
}

async function scheduleReminder(
  reminder: PlannedReminder,
  kind: ReminderData["kind"],
  t: Translate,
  locale: string,
): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    identifier: reminder.id,
    content: {
      title: reminder.title,
      body: reminderBody(reminder, t, locale),
      data: {
        stone: "reminder",
        kind,
        source: reminder.source,
        targetId: reminder.targetId,
      } satisfies ReminderData,
      ...(reminder.source === "task" ? { categoryIdentifier: TASK_REMINDER_CATEGORY } : {}),
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: new Date(reminder.fireAt),
      ...(Platform.OS === "android" ? { channelId: REMINDER_CHANNEL_ID } : {}),
    },
  });
}
