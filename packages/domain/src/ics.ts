import type { CalendarItem, CalendarRecurrence } from "./entities.js";
import { validateCalendarItem, zonedWallTimeToInstant } from "./calendar.js";

export const ICS_MAX_BYTES = 2_000_000;
export const ICS_MAX_EVENTS = 5_000;

export function exportCalendarIcs(items: readonly CalendarItem[]): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Stone//Calendar 1.0//EN",
    "CALSCALE:GREGORIAN",
  ];
  for (const source of items) {
    const item = validateCalendarItem(source);
    if (item.deletedAt) continue;
    lines.push("BEGIN:VEVENT", `UID:${escapeText(item.externalUid ?? `${item.id}@stone`)}`);
    lines.push(`SUMMARY:${escapeText(item.title)}`);
    if (item.description) lines.push(`DESCRIPTION:${escapeText(item.description)}`);
    if (item.location) lines.push(`LOCATION:${escapeText(item.location)}`);
    if (item.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${compactDate(item.startDate)}`);
      lines.push(`DTEND;VALUE=DATE:${compactDate(addDays(item.endDate, 1))}`);
    } else {
      lines.push(
        `DTSTART:${compactInstant(item.startAt!)}`,
        `DTEND:${compactInstant(item.endAt!)}`,
      );
    }
    if (item.recurrence) lines.push(`RRULE:${serializeRule(item.recurrence)}`);
    for (const override of item.overrides.filter((value) => value.cancelled))
      lines.push(`EXDATE;VALUE=DATE:${compactDate(override.occurrenceDate)}`);
    lines.push(`X-STONE-KIND:${item.kind}`, `X-STONE-CATEGORY:${item.category}`);
    if (item.projectId) lines.push(`X-STONE-PROJECT-ID:${escapeText(item.projectId)}`);
    if (item.taskId) lines.push(`X-STONE-TASK-ID:${escapeText(item.taskId)}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}

export function importCalendarIcs(
  source: string,
  context: { ownerId: string; deviceId: string; now: string; timezone: string },
): readonly CalendarItem[] {
  if (new TextEncoder().encode(source).length > ICS_MAX_BYTES)
    throw new Error("Calendar file is too large.");
  const unfolded = source.replace(/\r?\n[ \t]/gu, "");
  const blocks = [...unfolded.matchAll(/BEGIN:VEVENT\r?\n([\s\S]*?)\r?\nEND:VEVENT/gu)];
  if (blocks.length > ICS_MAX_EVENTS) throw new Error("Calendar file contains too many events.");
  return blocks.map((block, index) => parseEvent(block[1] ?? "", context, index));
}

function parseEvent(
  body: string,
  context: { ownerId: string; deviceId: string; now: string; timezone: string },
  index: number,
): CalendarItem {
  const properties = new Map<string, string>();
  for (const line of body.split(/\r?\n/u)) {
    const separator = line.indexOf(":");
    if (separator < 1) continue;
    properties.set(line.slice(0, separator).toUpperCase(), line.slice(separator + 1));
  }
  const summary = unescapeText(find(properties, "SUMMARY") ?? "");
  const start = property(properties, "DTSTART");
  const end = property(properties, "DTEND");
  if (!summary || !start || !end) throw new Error("Calendar event is missing required fields.");
  const allDay = start.key.includes("VALUE=DATE");
  const startValue = parseDateValue(start.value, context.timezone, allDay);
  const endValue = parseDateValue(end.value, context.timezone, allDay);
  const externalUid = unescapeText(find(properties, "UID") ?? "");
  const recurrence = parseRule(find(properties, "RRULE"));
  const idSeed = externalUid || `${summary}:${start.value}:${index}`;
  const startDate = startValue.date;
  const endDate = allDay ? addDays(endValue.date, -1) : endValue.date;
  return validateCalendarItem({
    schemaVersion: 1,
    id: `ics-${stableHash(idSeed)}`,
    ownerId: context.ownerId,
    revision: 1,
    createdAt: context.now,
    updatedAt: context.now,
    deletedAt: null,
    updatedByDeviceId: context.deviceId,
    kind: find(properties, "X-STONE-KIND") === "task_block" ? "task_block" : "event",
    title: summary,
    description: nullableText(find(properties, "DESCRIPTION")),
    allDay,
    startDate,
    endDate,
    startAt: startValue.instant,
    endAt: endValue.instant,
    timezone: context.timezone,
    location: nullableText(find(properties, "LOCATION")),
    category: parseCategory(find(properties, "X-STONE-CATEGORY")),
    projectId: nullableText(find(properties, "X-STONE-PROJECT-ID")),
    sourceDocumentId: null,
    taskId: nullableText(find(properties, "X-STONE-TASK-ID")),
    planningNote: null,
    recurrence,
    recurrenceSeriesId: recurrence ? `ics-${stableHash(idSeed)}` : null,
    recurrenceId: null,
    overrides: [],
    externalUid: externalUid || null,
    cancelledAt: null,
  });
}

function parseDateValue(
  value: string,
  timezone: string,
  allDay: boolean,
): { date: string; instant: string | null } {
  if (allDay) return { date: expandDate(value), instant: null };
  if (/^\d{8}T\d{6}Z$/u.test(value)) {
    const instant = `${expandDate(value.slice(0, 8))}T${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15)}.000Z`;
    return {
      date: new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date(instant)),
      instant,
    };
  }
  if (/^\d{8}T\d{6}$/u.test(value)) {
    const date = expandDate(value.slice(0, 8));
    return {
      date,
      instant: zonedWallTimeToInstant(
        date,
        `${value.slice(9, 11)}:${value.slice(11, 13)}`,
        timezone,
        "earlier",
      ),
    };
  }
  throw new Error("Calendar date value is unsupported.");
}

function serializeRule(value: CalendarRecurrence): string {
  const frequency =
    value.frequency === "weekdays"
      ? "WEEKLY"
      : value.frequency === "custom"
        ? value.unit.toUpperCase() + "LY"
        : value.frequency.toUpperCase();
  const parts = [`FREQ=${frequency}`, `INTERVAL=${value.interval}`];
  if (value.frequency === "weekdays") parts.push("BYDAY=MO,TU,WE,TH,FR");
  if (value.untilDate) parts.push(`UNTIL=${compactDate(value.untilDate)}`);
  return parts.join(";");
}

function parseRule(value: string | undefined): CalendarRecurrence | null {
  if (!value) return null;
  const fields = Object.fromEntries(value.split(";").map((part) => part.split("=", 2))) as Record<
    string,
    string
  >;
  const interval = Number(fields.INTERVAL ?? "1");
  const weekdays = fields.FREQ === "WEEKLY" && fields.BYDAY === "MO,TU,WE,TH,FR";
  const frequency = weekdays ? "weekdays" : fields.FREQ?.toLowerCase();
  if (
    !["daily", "weekdays", "weekly", "monthly"].includes(frequency ?? "") ||
    !Number.isInteger(interval) ||
    interval < 1
  )
    return null;
  return {
    frequency: frequency as CalendarRecurrence["frequency"],
    interval,
    unit: frequency === "monthly" ? "month" : frequency === "weekly" || weekdays ? "week" : "day",
    preferredDayOfMonth: null,
    untilDate: fields.UNTIL ? expandDate(fields.UNTIL.slice(0, 8)) : null,
  };
}

function property(map: Map<string, string>, name: string): { key: string; value: string } | null {
  const entry = [...map].find(([key]) => key === name || key.startsWith(`${name};`));
  return entry ? { key: entry[0], value: entry[1] } : null;
}
function find(map: Map<string, string>, name: string): string | undefined {
  return property(map, name)?.value;
}
function compactDate(value: string): string {
  return value.replaceAll("-", "");
}
function compactInstant(value: string): string {
  return value
    .replaceAll("-", "")
    .replaceAll(":", "")
    .replace(/\.\d{3}Z$/u, "Z");
}
function expandDate(value: string): string {
  if (!/^\d{8}$/u.test(value)) throw new Error("Calendar date is invalid.");
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}
function addDays(value: string, count: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}
function escapeText(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("\n", "\\n")
    .replaceAll(",", "\\,")
    .replaceAll(";", "\\;");
}
function unescapeText(value: string): string {
  return value.replace(/\\n/gu, "\n").replace(/\\([\\,;])/gu, "$1");
}
function nullableText(value: string | undefined): string | null {
  const text = value ? unescapeText(value).trim() : "";
  return text || null;
}
function parseCategory(value: string | undefined): CalendarItem["category"] {
  return ["neutral", "purple", "blue", "green", "amber", "red"].includes(value ?? "")
    ? (value as CalendarItem["category"])
    : "purple";
}
function foldLine(value: string): string {
  const chunks = value.match(/.{1,73}/gu) ?? [""];
  return chunks.join("\r\n ");
}
function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (const character of value) hash = Math.imul(hash ^ character.charCodeAt(0), 0x01000193);
  return (hash >>> 0).toString(36);
}
