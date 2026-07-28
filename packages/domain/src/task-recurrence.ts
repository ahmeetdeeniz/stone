import type { Task, TaskRecurrence } from "./entities.js";
import { validateRecurrence } from "./task-logic.js";

export function nextOccurrenceDate(currentDate: string, recurrence: TaskRecurrence): string {
  validateRecurrence(recurrence);
  const current = parseDate(currentDate);
  if (recurrence.frequency === "weekdays") {
    do current.setUTCDate(current.getUTCDate() + 1);
    while (current.getUTCDay() === 0 || current.getUTCDay() === 6);
    return formatDate(current);
  }
  if (recurrence.frequency === "daily") return addDays(current, recurrence.interval);
  if (recurrence.frequency === "weekly") return addDays(current, recurrence.interval * 7);
  if (recurrence.frequency === "monthly")
    return addMonths(current, recurrence.interval, recurrence.preferredDayOfMonth);
  if (recurrence.unit === "day") return addDays(current, recurrence.interval);
  if (recurrence.unit === "week") return addDays(current, recurrence.interval * 7);
  return addMonths(current, recurrence.interval, recurrence.preferredDayOfMonth);
}

export function occurrenceId(seriesId: string, scheduledDate: string): string {
  return `${seriesId}:${scheduledDate}`;
}

export function createNextRecurringTask(task: Task, completedAt: string): Task | null {
  if (!task.recurrence) return null;
  const currentDate = task.occurrenceDate ?? task.dueDate;
  if (!currentDate) return null;
  const scheduledDate = nextOccurrenceDate(currentDate, task.recurrence);
  const seriesId = task.recurrenceSeriesId ?? task.id;
  return {
    ...task,
    id: occurrenceId(seriesId, scheduledDate),
    state: "open",
    completedAt: null,
    dueDate: task.dueDate ? scheduledDate : null,
    occurrenceDate: scheduledDate,
    recurrenceSeriesId: seriesId,
    revision: 1,
    createdAt: completedAt,
    updatedAt: completedAt,
    deletedAt: null,
  };
}

function parseDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) throw new Error("Invalid recurrence date.");
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (formatDate(date) !== value) throw new Error("Invalid recurrence date.");
  return date;
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): string {
  date.setUTCDate(date.getUTCDate() + days);
  return formatDate(date);
}

function addMonths(date: Date, months: number, preferredDay: number | null): string {
  const day = preferredDay ?? date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const finalDay = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
  ).getUTCDate();
  date.setUTCDate(Math.min(day, finalDay));
  return formatDate(date);
}
