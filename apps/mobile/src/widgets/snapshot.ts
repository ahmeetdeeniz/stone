import {
  focusGoalProgress,
  pauseFocusSession,
  resumeFocusSession,
  finishFocusSession,
  startFocusSession,
  type FocusSession,
  type Task,
} from "@stone/domain";
import {
  WIDGET_SNAPSHOT_VERSION,
  parseWidgetSnapshot,
  pendingWidgetActions,
  redactWidgetSnapshot,
  type WidgetAction,
  type WidgetLocale,
  type WidgetPrivacy,
  type WidgetSnapshot,
} from "@stone/widgets";
import type { AppServices } from "../services/composition-root";
import {
  acknowledgeNativeWidgetActions,
  clearNativeWidgetData,
  readNativeWidgetActions,
  writeNativeWidgetSnapshot,
} from "./native-widget-bridge";

const SNAPSHOT_TTL_MS = 60 * 60 * 1_000;

export async function buildWidgetSnapshot(
  services: AppServices,
  ownerId: string,
  locale: WidgetLocale,
  privacy: WidgetPrivacy,
  now = new Date(),
): Promise<WidgetSnapshot> {
  const date = localDate(now, Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  const nextDate = new Date(`${date}T12:00:00.000Z`);
  nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const rangeStart = new Date(now);
  rangeStart.setUTCDate(rangeStart.getUTCDate() - 7);
  const [tasks, agenda, active, goal, recentFocus] = await Promise.all([
    services.tasks
      .list(ownerId, { state: "open", limit: 100 })
      .then((items) => items.filter((task) => task.dueDate && task.dueDate <= date).slice(0, 8)),
    services.calendar.list(ownerId, {
      startDate: date,
      endDate: nextDate.toISOString().slice(0, 10),
      limit: 8,
    }),
    services.focus.getActive(ownerId),
    services.focus.getGoal(ownerId),
    services.focus.list(ownerId, {
      startAt: rangeStart.toISOString(),
      endAt: now.toISOString(),
      limit: 2_000,
    }),
  ]);
  const focus = active[0] ?? null;
  const progress = goal ? focusGoalProgress(recentFocus, goal, date) : null;
  const generatedAt = now.toISOString();
  const snapshot = parseWidgetSnapshot({
    schemaVersion: WIDGET_SNAPSHOT_VERSION,
    generatedAt,
    lastSuccessfulRefreshAt: generatedAt,
    staleAfter: new Date(now.getTime() + SNAPSHOT_TTL_MS).toISOString(),
    locale,
    timezone,
    privacy,
    authenticated: true,
    todayRemainingCount: tasks.length,
    todayTasks: tasks.slice(0, 8).map(taskSummary),
    agenda: agenda.slice(0, 8).map((item) => ({
      id: item.id,
      kind: item.kind === "task_block" ? "task_block" : "event",
      title: item.title,
      startAt: item.startAt,
      endAt: item.endAt,
      allDay: item.allDay,
      projectName: null,
    })),
    focus: focus ? focusSummary(focus) : null,
    dailyGoalSeconds: progress?.dailyTargetSeconds ?? 0,
    dailyFocusedSeconds: progress?.dailySeconds ?? 0,
    quickActionsEnabled: true,
  });
  return redactWidgetSnapshot(snapshot, privacy);
}

export async function refreshNativeWidgets(
  services: AppServices,
  ownerId: string,
  locale: WidgetLocale,
  privacy: WidgetPrivacy,
): Promise<void> {
  await processNativeWidgetActions(services, ownerId);
  await writeNativeWidgetSnapshot(await buildWidgetSnapshot(services, ownerId, locale, privacy));
}

export async function clearWidgetsForAccountLifecycle(): Promise<void> {
  await clearNativeWidgetData();
}

export async function processNativeWidgetActions(
  services: AppServices,
  ownerId: string,
  now = new Date(),
): Promise<void> {
  const queue = await readNativeWidgetActions();
  const actions = pendingWidgetActions(queue, now.toISOString());
  const acknowledged: string[] = [];
  for (const action of actions) {
    try {
      await executeAction(services, ownerId, action, now.toISOString());
      acknowledged.push(action.id);
    } catch (error) {
      if (isIdempotentTerminal(error)) acknowledged.push(action.id);
    }
  }
  await acknowledgeNativeWidgetActions(acknowledged);
}

async function executeAction(
  services: AppServices,
  ownerId: string,
  action: WidgetAction,
  now: string,
): Promise<void> {
  if (action.type === "complete_task" || action.type === "reopen_task") {
    if (!action.targetId) throw new Error("Widget task action requires a target.");
    const task = await services.tasks.getById(ownerId, action.targetId);
    if (!task) throw new Error("Widget task target not found.");
    if (task.revision !== action.expectedRevision)
      throw new Error("Widget task revision conflict.");
    if (action.type === "complete_task")
      await services.taskUseCases.complete(ownerId, task.id, now, services.deviceId);
    else await services.taskUseCases.reopen(ownerId, task.id, services.deviceId);
    return;
  }
  if (action.type === "start_focus") {
    if ((await services.focus.getActive(ownerId)).length) return;
    await services.focus.create(
      startFocusSession(
        {
          id: action.id,
          ownerId,
          deviceId: services.deviceId,
          mode: "countdown",
          plannedDurationSeconds: 25 * 60,
        },
        { now: () => now },
      ),
    );
    return;
  }
  if (!action.targetId) throw new Error("Widget focus action requires a target.");
  const current = await services.focus.getById(ownerId, action.targetId);
  if (!current) throw new Error("Widget focus target not found.");
  if (current.revision !== action.expectedRevision)
    throw new Error("Widget focus revision conflict.");
  const clock = { now: () => now };
  const next =
    action.type === "pause_focus"
      ? pauseFocusSession(current, clock)
      : action.type === "resume_focus"
        ? resumeFocusSession(current, clock)
        : finishFocusSession(current, clock);
  await services.focus.save(ownerId, next, current.revision, services.deviceId);
}

function taskSummary(task: Task) {
  return {
    id: task.id,
    title: task.title,
    completed: task.state === "completed",
    revision: task.revision,
    dueLabel: task.dueDate,
    priority: task.priority,
    projectName: null,
  };
}

function focusSummary(session: FocusSession) {
  return {
    sessionId: session.id,
    mode: session.mode,
    phase: session.phase,
    status: session.status as "running" | "paused",
    startedAt: session.startedAt,
    plannedDurationSeconds: session.plannedDurationSeconds,
    accumulatedPausedSeconds: session.accumulatedPausedSeconds,
    pausedAt: session.status === "paused" ? (session.pauses.at(-1)?.startedAt ?? null) : null,
    contextTitle: session.note,
    revision: session.revision,
  };
}

function localDate(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function isIdempotentTerminal(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.includes("already") ||
      error.message.includes("completed") ||
      error.message.includes("transition"))
  );
}
