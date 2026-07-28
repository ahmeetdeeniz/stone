import type { CalendarItem, CalendarOccurrence } from "./entities.js";
import { validateCalendarItem } from "./calendar.js";
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

function shiftItem(
  item: CalendarItem,
  date: string,
  durationDays: number,
  override: CalendarItem["overrides"][number] | undefined,
): CalendarItem {
  const dayDelta = dateDistance(item.startDate, date);
  return {
    ...item,
    title: override?.title ?? item.title,
    startDate: date,
    endDate: addDays(date, durationDays),
    startAt: override?.startAt ?? (item.startAt ? shiftInstant(item.startAt, dayDelta) : null),
    endAt: override?.endAt ?? (item.endAt ? shiftInstant(item.endAt, dayDelta) : null),
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

function shiftInstant(value: string, days: number): string {
  return new Date(Date.parse(value) + days * 86_400_000).toISOString();
}
