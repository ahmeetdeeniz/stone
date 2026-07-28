import type { CalendarItem, CalendarOccurrence, CalendarRecurrenceEditScope } from "./entities.js";
import {
  instantToZonedWallTime,
  validateCalendarItem,
  zonedWallTimeToInstant,
} from "./calendar.js";
import { nextOccurrenceDate, occurrenceId } from "./task-recurrence.js";

export function expandCalendarOccurrences(
  source: CalendarItem,
  windowStart: string,
  windowEnd: string,
  maximum = 1_000,
): readonly CalendarOccurrence[] {
  const item = validateCalendarItem(source);
  if (windowEnd < windowStart || maximum < 1 || maximum > 10_000)
    throw new Error("Calendar expansion window is invalid.");
  if (!item.recurrence) return overlaps(item, windowStart, windowEnd) ? [toOccurrence(item)] : [];
  const output: CalendarOccurrence[] = [];
  let date = item.startDate;
  const durationDays = dateDistance(item.startDate, item.endDate);
  for (let count = 0; date <= windowEnd && count < maximum; count += 1) {
    if (item.recurrence.untilDate && date > item.recurrence.untilDate) break;
    const override = item.overrides.find((value) => value.occurrenceDate === date);
    if (!override?.cancelled) {
      const occurrence = shiftItem(item, date, durationDays, override);
      if (overlaps(occurrence, windowStart, windowEnd))
        output.push({
          id: occurrenceId(item.recurrenceSeriesId ?? item.id, date),
          itemId: item.id,
          seriesId: item.recurrenceSeriesId ?? item.id,
          occurrenceDate: date,
          item: occurrence,
        });
    }
    date = nextOccurrenceDate(date, item.recurrence);
  }
  return output;
}

export interface CalendarOccurrenceChanges {
  title?: string;
  startAt?: string | null;
  endAt?: string | null;
  startDate?: string;
  endDate?: string;
  description?: string | null;
  location?: string | null;
  category?: CalendarItem["category"];
}

export interface CalendarSeriesMutation {
  current: CalendarItem;
  future: CalendarItem | null;
}

export function editCalendarRecurrence(
  source: CalendarItem,
  occurrenceDate: string,
  scope: CalendarRecurrenceEditScope,
  changes: CalendarOccurrenceChanges,
  futureId: string,
): CalendarSeriesMutation {
  const item = validateCalendarItem(source);
  requireOccurrence(item, occurrenceDate);
  if (scope === "occurrence") {
    return {
      current: validateCalendarItem({
        ...item,
        overrides: upsertOverride(item, occurrenceDate, {
          occurrenceDate,
          cancelled: false,
          title: changes.title ?? null,
          startAt: changes.startAt ?? null,
          endAt: changes.endAt ?? null,
        }),
      }),
      future: null,
    };
  }
  if (scope === "series") {
    return {
      current: validateCalendarItem({ ...item, ...changes }),
      future: null,
    };
  }
  if (occurrenceDate <= item.startDate)
    return {
      current: validateCalendarItem({ ...item, ...changes }),
      future: null,
    };
  const previous = addDays(occurrenceDate, -1);
  const retainedOverrides = item.overrides.filter((value) => value.occurrenceDate < occurrenceDate);
  const futureOverrides = item.overrides.filter((value) => value.occurrenceDate >= occurrenceDate);
  const current = validateCalendarItem({
    ...item,
    recurrence: item.recurrence ? { ...item.recurrence, untilDate: previous } : null,
    overrides: retainedOverrides,
  });
  const durationDays = dateDistance(item.startDate, item.endDate);
  const future = validateCalendarItem({
    ...item,
    ...changes,
    id: futureId,
    startDate: changes.startDate ?? occurrenceDate,
    endDate: changes.endDate ?? addDays(occurrenceDate, durationDays),
    recurrenceSeriesId: futureId,
    recurrenceId: null,
    overrides: futureOverrides,
    revision: 1,
    createdAt: item.updatedAt,
    deletedAt: null,
  });
  return { current, future };
}

export function deleteCalendarRecurrence(
  source: CalendarItem,
  occurrenceDate: string,
  scope: CalendarRecurrenceEditScope,
  deletedAt: string,
  futureId: string,
): CalendarSeriesMutation {
  const item = validateCalendarItem(source);
  requireOccurrence(item, occurrenceDate);
  if (scope === "occurrence") {
    return {
      current: validateCalendarItem({
        ...item,
        overrides: upsertOverride(item, occurrenceDate, {
          occurrenceDate,
          cancelled: true,
          title: null,
          startAt: null,
          endAt: null,
        }),
      }),
      future: null,
    };
  }
  if (scope === "series" || occurrenceDate <= item.startDate) {
    return {
      current: validateCalendarItem({ ...item, deletedAt, cancelledAt: deletedAt }),
      future: null,
    };
  }
  const split = editCalendarRecurrence(item, occurrenceDate, "future", {}, futureId);
  return {
    current: split.current,
    future: split.future
      ? validateCalendarItem({
          ...split.future,
          deletedAt,
          cancelledAt: deletedAt,
        })
      : null,
  };
}

function requireOccurrence(item: CalendarItem, occurrenceDate: string): void {
  if (!item.recurrence) throw new Error("Calendar item is not recurring.");
  const match = expandCalendarOccurrences(item, occurrenceDate, occurrenceDate, 10_000);
  if (match.length === 0) throw new Error("Calendar occurrence is outside the series.");
}

function upsertOverride(
  item: CalendarItem,
  occurrenceDate: string,
  value: CalendarItem["overrides"][number],
): readonly CalendarItem["overrides"][number][] {
  return [
    ...item.overrides.filter((override) => override.occurrenceDate !== occurrenceDate),
    value,
  ].sort((left, right) => left.occurrenceDate.localeCompare(right.occurrenceDate));
}

function shiftItem(
  item: CalendarItem,
  date: string,
  durationDays: number,
  override: CalendarItem["overrides"][number] | undefined,
): CalendarItem {
  return {
    ...item,
    title: override?.title ?? item.title,
    startDate: date,
    endDate: addDays(date, durationDays),
    startAt:
      override?.startAt ?? (item.startAt ? shiftInstant(item.startAt, date, item.timezone) : null),
    endAt:
      override?.endAt ??
      (item.endAt ? shiftInstant(item.endAt, addDays(date, durationDays), item.timezone) : null),
    recurrenceId: date,
  };
}

function toOccurrence(item: CalendarItem): CalendarOccurrence {
  return {
    id: item.id,
    itemId: item.id,
    seriesId: item.recurrenceSeriesId,
    occurrenceDate: item.startDate,
    item,
  };
}

function overlaps(item: CalendarItem, start: string, end: string): boolean {
  return item.endDate >= start && item.startDate <= end;
}

function dateDistance(left: string, right: string): number {
  return Math.round(
    (Date.parse(`${right}T00:00:00Z`) - Date.parse(`${left}T00:00:00Z`)) / 86_400_000,
  );
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function shiftInstant(value: string, date: string, timezone: string): string {
  const time = instantToZonedWallTime(value, timezone).slice(11, 16);
  try {
    return zonedWallTimeToInstant(date, time, timezone, "earlier");
  } catch {
    // A series that lands in a spring-forward gap advances to the first valid quarter-hour.
    const [hour, minute] = time.split(":").map(Number) as [number, number];
    for (let delta = 15; delta <= 180; delta += 15) {
      const total = hour * 60 + minute + delta;
      const next = `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
      try {
        return zonedWallTimeToInstant(date, next, timezone, "earlier");
      } catch {
        // Continue until the gap ends.
      }
    }
    throw new Error("Recurring calendar time cannot be resolved.");
  }
}
