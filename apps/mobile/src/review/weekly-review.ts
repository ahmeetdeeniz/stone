import {
  aggregateFocusSessions,
  expandCalendarOccurrences,
  type CalendarItem,
  type FocusSession,
  type Task,
} from "@stone/domain";

export interface WeeklyReview {
  /** Inclusive local dates of the past seven days (ending today). */
  pastStart: string;
  today: string;
  /** Inclusive local dates of the coming seven days (starting tomorrow). */
  nextEnd: string;
  completed: readonly Task[];
  overdue: readonly Task[];
  dueNextWeek: readonly Task[];
  upcomingEvents: readonly { id: string; itemId: string; title: string; date: string }[];
  focusedSeconds: number;
  focusSessions: number;
  /** Focused seconds per local day of the past week, oldest first (seven entries). */
  focusByDay: readonly { date: string; seconds: number }[];
}

/**
 * Looks back at the last seven days and ahead at the next seven: what got done, what slipped,
 * what is coming, and how much focused time went in. Dates are the device's calendar days.
 */
export function buildWeeklyReview(input: {
  tasks: readonly Task[];
  focusSessions: readonly FocusSession[];
  calendarItems: readonly CalendarItem[];
  today: string;
  timezone: string;
}): WeeklyReview {
  const { today, timezone } = input;
  const pastStart = addDays(today, -6);
  const tomorrow = addDays(today, 1);
  const nextEnd = addDays(today, 7);
  const open = input.tasks.filter((task) => !task.deletedAt && task.state === "open");

  const completed = input.tasks
    .filter(
      (task) =>
        !task.deletedAt &&
        task.state === "completed" &&
        task.completedAt !== null &&
        between(localDate(task.completedAt, timezone), pastStart, today),
    )
    .sort((left, right) => (right.completedAt ?? "").localeCompare(left.completedAt ?? ""));
  const overdue = open
    .filter((task) => task.dueDate !== null && task.dueDate < today)
    .sort((left, right) => (left.dueDate ?? "").localeCompare(right.dueDate ?? ""));
  const dueNextWeek = open
    .filter((task) => task.dueDate !== null && between(task.dueDate, tomorrow, nextEnd))
    .sort(
      (left, right) =>
        (left.dueDate ?? "").localeCompare(right.dueDate ?? "") ||
        (left.dueTime ?? "99:99").localeCompare(right.dueTime ?? "99:99"),
    );

  const upcomingEvents = input.calendarItems
    .filter((item) => !item.deletedAt && !item.cancelledAt)
    .flatMap((item) => {
      try {
        return expandCalendarOccurrences(item, tomorrow, nextEnd, 64);
      } catch {
        return [];
      }
    })
    .filter((occurrence) => !occurrence.item.cancelledAt)
    .map((occurrence) => ({
      id: occurrence.id,
      itemId: occurrence.itemId,
      title: occurrence.item.title,
      date: occurrence.occurrenceDate,
    }))
    .sort(
      (left, right) => left.date.localeCompare(right.date) || left.title.localeCompare(right.title),
    );

  const pastSessions = input.focusSessions.filter((session) =>
    between(localDate(session.startedAt, timezone), pastStart, today),
  );
  const summary = aggregateFocusSessions(pastSessions, timezone);
  const focusByDay = Array.from({ length: 7 }, (_, index) => {
    const date = addDays(pastStart, index);
    return { date, seconds: summary.byDay[date] ?? 0 };
  });

  return {
    pastStart,
    today,
    nextEnd,
    completed,
    overdue,
    dueNextWeek,
    upcomingEvents,
    focusedSeconds: summary.focusedSeconds,
    focusSessions: summary.completedSessions,
    focusByDay,
  };
}

/** The device's calendar day as YYYY-MM-DD. */
export function localToday(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function between(date: string, start: string, end: string): boolean {
  return date >= start && date <= end;
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function localDate(instant: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(instant));
}
