import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { useI18n } from "../i18n/provider";
import { useAppServices } from "../providers/app-provider";
import { useAuth } from "../providers/auth-provider";
import { useNavigationReady } from "../widgets/native-deep-links";
import {
  cancelAllReminders,
  configureReminders,
  isReminderData,
  REMINDER_ACTION_COMPLETE,
  REMINDER_ACTION_SNOOZE,
  snoozeReminder,
  syncReminders,
} from "./reminders";

/**
 * Keeps OS reminders in step with local tasks and calendar items, and handles taps and the
 * Complete / Snooze actions. Rescheduling runs on foreground and background transitions, which
 * covers edits made in any screen without wiring every save path.
 */
export function ReminderLifecycle() {
  const services = useAppServices();
  const { user, status } = useAuth();
  const { t, locale, ready } = useI18n();
  const router = useRouter();
  const navigationReady = useNavigationReady();
  const handled = useRef(new Set<string>());
  const queued = useRef<Notifications.NotificationResponse[]>([]);
  const [queueVersion, setQueueVersion] = useState(0);

  const resync = useCallback(async () => {
    if (!user || !ready) return;
    await configureReminders(t);
    await syncReminders(services, user.uid, t, locale);
  }, [locale, ready, services, t, user]);

  useEffect(() => {
    if (status !== "ready") return;
    if (!user) void cancelAllReminders().catch(() => undefined);
    else void resync().catch(() => undefined);
  }, [resync, status, user]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active" || state === "background") void resync().catch(() => undefined);
    });
    return () => subscription.remove();
  }, [resync]);

  const respond = useCallback(
    async (response: Notifications.NotificationResponse) => {
      const data = response.notification.request.content.data;
      const key = `${response.notification.request.identifier}:${response.actionIdentifier}`;
      if (!isReminderData(data) || handled.current.has(key) || !user) return;
      handled.current.add(key);
      if (response.actionIdentifier === REMINDER_ACTION_SNOOZE) {
        await snoozeReminder(response.notification);
      } else if (response.actionIdentifier === REMINDER_ACTION_COMPLETE && data.source === "task") {
        await services.taskUseCases.complete(
          user.uid,
          data.targetId,
          new Date().toISOString(),
          services.deviceId,
        );
        await resync();
      } else if (data.source === "task") {
        router.push({ pathname: "/task/[id]", params: { id: data.targetId } });
      } else {
        router.push({ pathname: "/calendar/[id]", params: { id: data.targetId } });
      }
      await Notifications.dismissNotificationAsync(response.notification.request.identifier);
      // Otherwise the next cold start would replay this response.
      await Notifications.clearLastNotificationResponseAsync();
    },
    [resync, router, services, user],
  );

  // Responses can arrive (cold start, or before sign-in finished) while navigation is not mounted;
  // queue them and replay once the root navigator and the session are ready.
  useEffect(() => {
    const enqueue = (response: Notifications.NotificationResponse | null) => {
      if (!response) return;
      queued.current.push(response);
      setQueueVersion((version) => version + 1);
    };
    const subscription = Notifications.addNotificationResponseReceivedListener(enqueue);
    void Notifications.getLastNotificationResponseAsync().then(enqueue);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!navigationReady || status !== "ready" || !user) return;
    for (const response of queued.current.splice(0)) void respond(response).catch(() => undefined);
  }, [navigationReady, queueVersion, respond, status, user]);

  return null;
}
