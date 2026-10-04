import type { CalendarItem, Task } from "./entities.js";
import { expandCalendarOccurrences } from "./calendar-recurrence.js";
import { zonedWallTimeToInstant } from "./calendar.js";

export type ReminderSource = "task" | "calendar";

export interface ReminderSettings {
  enabled: boolean;
  /** Minutes before a timed task or event; 0 fires at the exact time. */
  leadMinutes: number;
  /** Local wall time (HH:mm) used for date-only tasks and all-day events. */
  allDayTime: string;
}

export interface PlannedReminder {
  /** Stable for the same entity occurrence and fire time, so rescheduling is idempotent. */
  id: string;
  source: ReminderSource;
  entityId: string;
  /** The task id, or the calendar item id an occurrence belongs to (what a tap should open). */
  targetId: string;
  title: string;
  fireAt: string;
  /** Start/due instant shown to the user (equals fireAt when there is no lead time). */
  dueAt: string;
  allDay: boolean;
}

export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = {
  enabled: true,
  leadMinutes: 15,
  allDayTime: "09:00",
};

export const REMINDER_LEAD_CHOICES = [0, 5, 15, 30, 60] as const;

/** iOS keeps at most 64 pending local notifications per app; stay well below it. */
export const MAX_SCHEDULED_REMINDERS = 48;
export const REMINDER_WINDOW_DAYS = 14;

/**
 * Plans the next local reminders for open tasks with a due date and for upcoming calendar items.
 * Pure and deterministic so the native scheduler only diffs the result against what is pending.
 */
export function planReminders(input: {
  tasks: readonly Task[];
  calendarItems: readonly CalendarItem[];
  now: Date;
  settings: ReminderSettings;
  windowDays?: number;
  limit?: number;
}): readonly PlannedReminder[] {
  const { settings, now } = input;
  if (!settings.enabled) return [];
  const leadMs = Math.max(0, settings.leadMinutes) * 60_000;
  const windowEnd = now.getTime() + (input.windowDays ?? REMINDER_WINDOW_DAYS) * 86_400_000;
  const planned: PlannedReminder[] = [];

  const push = (reminder: Omit<PlannedReminder, "fireAt" | "id">, dueMs: number, lead: number) => {
    const fireMs = dueMs - lead;
    if (fireMs <= now.getTime() || fireMs > windowEnd) return;
    const fireAt = new Date(fireMs).toISOString();
    planned.push({
      ...reminder,
      id: `${reminder.source}:${reminder.entityId}:${fireAt}`,
      fireAt,
    });
  };

  for (const task of input.tasks) {
    if (task.deletedAt || task.state !== "open" || !task.dueDate) continue;
    const allDay = task.dueTime === null;
    const dueMs = wallTimeMs(task.dueDate, task.dueTime ?? settings.allDayTime, task.timezone);
    if (dueMs === null) continue;
    push(
      {
        source: "task",
        entityId: task.id,
        targetId: task.id,
        title: task.title,
        dueAt: new Date(dueMs).toISOString(),
        allDay,
      },
      dueMs,
      allDay ? 0 : leadMs,
    );
  }

  // Calendar dates are local; widen the UTC window by a day each side and filter on fireAt.
  const startDate = isoDate(new Date(now.getTime() - 86_400_000));
  const endDate = isoDate(new Date(windowEnd + 86_400_000));
  for (const source of input.calendarItems) {
    if (source.deletedAt || source.cancelledAt) continue;
    let occurrences;
    try {
      occurrences = expandCalendarOccurrences(source, startDate, endDate, 64);
    } catch {
      continue;
    }
    for (const occurrence of occurrences) {
      const item = occurrence.item;
      if (item.cancelledAt) continue;
      const dueMs = item.allDay
        ? wallTimeMs(item.startDate, settings.allDayTime, item.timezone)
        : item.startAt
          ? Date.parse(item.startAt)
          : null;
      if (dueMs === null || !Number.isFinite(dueMs)) continue;
      push(
        {
          source: "calendar",
          entityId: occurrence.id,
          targetId: occurrence.itemId,
          title: item.title,
          dueAt: new Date(dueMs).toISOString(),
          allDay: item.allDay,
        },
        dueMs,
        item.allDay ? 0 : leadMs,
      );
    }
  }

  planned.sort(
    (left, right) => left.fireAt.localeCompare(right.fireAt) || left.id.localeCompare(right.id),
  );
  return planned.slice(0, input.limit ?? MAX_SCHEDULED_REMINDERS);
}

/** Returns which pending ids to cancel and which planned reminders to schedule. */
export function diffReminders(
  pendingIds: readonly string[],
  planned: readonly PlannedReminder[],
): { cancel: readonly string[]; schedule: readonly PlannedReminder[] } {
  const wanted = new Set(planned.map((reminder) => reminder.id));
  const pending = new Set(pendingIds);
  return {
    cancel: pendingIds.filter((id) => !wanted.has(id)),
    schedule: planned.filter((reminder) => !pending.has(reminder.id)),
  };
}

export function parseReminderSettings(value: unknown): ReminderSettings {
  if (typeof value !== "object" || value === null) return DEFAULT_REMINDER_SETTINGS;
  const record = value as Record<string, unknown>;
  const lead = Number(record.leadMinutes);
  const time = typeof record.allDayTime === "string" ? record.allDayTime : "";
  return {
    enabled:
      typeof record.enabled === "boolean" ? record.enabled : DEFAULT_REMINDER_SETTINGS.enabled,
    leadMinutes: (REMINDER_LEAD_CHOICES as readonly number[]).includes(lead)
      ? lead
      : DEFAULT_REMINDER_SETTINGS.leadMinutes,
    allDayTime: /^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(time)
      ? time
      : DEFAULT_REMINDER_SETTINGS.allDayTime,
  };
}

function wallTimeMs(date: string, time: string, timezone: string): number | null {
  try {
    return Date.parse(zonedWallTimeToInstant(date, time, timezone, "earlier"));
  } catch {
    // A wall time skipped by a DST jump has no instant; remind an hour later instead.
    const [hour, minute] = time.split(":").map(Number) as [number, number];
    if (!Number.isInteger(hour) || hour >= 23) return null;
    const shifted = `${String(hour + 1).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    try {
      return Date.parse(zonedWallTimeToInstant(date, shifted, timezone, "earlier"));
    } catch {
      return null;
    }
  }
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}
