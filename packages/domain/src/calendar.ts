import type {
  CalendarCategory,
  CalendarItem,
  CalendarListOptions,
  CalendarOccurrenceOverride,
} from "./entities.js";
import { ValidationError } from "./errors.js";
import { isValidIsoDate } from "./project-logic.js";
import { isValidTimeZone, validateRecurrence } from "./task-logic.js";

export const calendarCategories: readonly CalendarCategory[] = [
  "neutral",
  "purple",
  "blue",
  "green",
  "amber",
  "red",
];

export function validateCalendarItem(item: CalendarItem): CalendarItem {
  if (item.schemaVersion !== 1) throw new ValidationError("Unsupported calendar schema version.");
  if (!item.id.trim() || !item.ownerId.trim())
    throw new ValidationError("Calendar identity is required.");
  if (!item.title.trim() || item.title.length > 512)
    throw new ValidationError("Calendar title is invalid.");
  if (item.kind !== "event" && item.kind !== "task_block")
    throw new ValidationError("Calendar item kind is invalid.");
  if (item.kind === "task_block" && !item.taskId)
    throw new ValidationError("A scheduled task block must reference a task.");
  if (!isValidIsoDate(item.startDate) || !isValidIsoDate(item.endDate))
    throw new ValidationError("Calendar dates must be YYYY-MM-DD.");
  if (item.endDate < item.startDate) throw new ValidationError("Calendar end precedes start.");
  if (!isValidTimeZone(item.timezone)) throw new ValidationError("Calendar timezone is invalid.");
  if (!calendarCategories.includes(item.category))
    throw new ValidationError("Calendar category is invalid.");
  if (item.description && item.description.length > 64_000)
    throw new ValidationError("Calendar description is too long.");
  if (item.location && item.location.length > 1_000)
    throw new ValidationError("Calendar location is too long.");
  if (item.planningNote && item.planningNote.length > 8_000)
    throw new ValidationError("Planning note is too long.");
  if (item.allDay) {
    if (item.startAt || item.endAt)
      throw new ValidationError("All-day items use date-only boundaries.");
  } else {
    if (!isIsoInstant(item.startAt) || !isIsoInstant(item.endAt))
      throw new ValidationError("Timed items require canonical UTC instants.");
    if (Date.parse(item.endAt) <= Date.parse(item.startAt))
      throw new ValidationError("Calendar end must be after start.");
  }
  if (item.recurrence) {
    validateRecurrence(item.recurrence);
    if (item.recurrence.untilDate && !isValidIsoDate(item.recurrence.untilDate))
      throw new ValidationError("Recurrence end date is invalid.");
  }
  const seen = new Set<string>();
  for (const override of item.overrides) {
    validateOverride(override, seen);
  }
  return { ...item, title: item.title.trim(), overrides: [...item.overrides] };
}

export function matchesCalendarList(item: CalendarItem, options: CalendarListOptions): boolean {
  if (!options.includeDeleted && item.deletedAt) return false;
  if (item.endDate < options.startDate || item.startDate > options.endDate) return false;
  if (options.projectId && item.projectId !== options.projectId) return false;
  if (options.kind && item.kind !== options.kind) return false;
  if (options.category && item.category !== options.category) return false;
  if (options.search) {
    const query = options.search.trim().toLocaleLowerCase();
    const text =
      `${item.title}\n${item.description ?? ""}\n${item.location ?? ""}`.toLocaleLowerCase();
    if (!text.includes(query)) return false;
  }
  return true;
}

export function zonedWallTimeToInstant(
  date: string,
  time: string,
  timezone: string,
  disambiguation: "earlier" | "later" | "reject" = "reject",
): string {
  if (!isValidIsoDate(date) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(time))
    throw new ValidationError("Wall time is invalid.");
  if (!isValidTimeZone(timezone)) throw new ValidationError("Timezone is invalid.");
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const [hour, minute] = time.split(":").map(Number) as [number, number];
  const target = Date.UTC(year, month - 1, day, hour, minute);
  const matches: number[] = [];
  for (let offsetMinutes = -14 * 60; offsetMinutes <= 14 * 60; offsetMinutes += 15) {
    const candidate = target - offsetMinutes * 60_000;
    if (wallParts(candidate, timezone) === `${date}T${time}`) matches.push(candidate);
  }
  if (matches.length === 0) throw new ValidationError("Wall time falls in a timezone gap.");
  matches.sort((left, right) => left - right);
  if (matches.length > 1 && disambiguation === "reject")
    throw new ValidationError("Wall time is repeated; choose earlier or later.");
  const instant = disambiguation === "later" ? matches.at(-1) : matches[0];
  return new Date(instant ?? matches[0]!).toISOString();
}

export function instantToZonedWallTime(instant: string, timezone: string): string {
  if (!isIsoInstant(instant) || !isValidTimeZone(timezone))
    throw new ValidationError("Instant or timezone is invalid.");
  return wallParts(Date.parse(instant), timezone);
}

function wallParts(timestamp: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

function isIsoInstant(value: string | null): value is string {
  return (
    value !== null && /^\d{4}-\d{2}-\d{2}T.*Z$/u.test(value) && Number.isFinite(Date.parse(value))
  );
}

function validateOverride(value: CalendarOccurrenceOverride, seen: Set<string>): void {
  if (!isValidIsoDate(value.occurrenceDate) || seen.has(value.occurrenceDate))
    throw new ValidationError("Calendar occurrence override is invalid or duplicated.");
  seen.add(value.occurrenceDate);
  if ((value.startAt === null) !== (value.endAt === null))
    throw new ValidationError("Occurrence override boundaries are incomplete.");
  if (value.startAt && (!isIsoInstant(value.startAt) || !isIsoInstant(value.endAt)))
    throw new ValidationError("Occurrence override boundaries are invalid.");
}
