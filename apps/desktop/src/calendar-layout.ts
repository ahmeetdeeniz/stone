import { instantToZonedWallTime, type CalendarItem } from "@stone/domain";

export interface CalendarDay {
  date: string;
  inPeriod: boolean;
  isToday: boolean;
}

export interface PositionedCalendarItem {
  item: CalendarItem;
  top: number;
  height: number;
  column: number;
  columns: number;
}

export function monthGrid(anchor: string, today: string): readonly CalendarDay[] {
  const [year, month] = anchor.split("-").map(Number) as [number, number];
  const first = new Date(Date.UTC(year, month - 1, 1));
  const mondayOffset = (first.getUTCDay() + 6) % 7;
  first.setUTCDate(first.getUTCDate() - mondayOffset);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(first);
    date.setUTCDate(date.getUTCDate() + index);
    const value = date.toISOString().slice(0, 10);
    return { date: value, inPeriod: date.getUTCMonth() === month - 1, isToday: value === today };
  });
}

export function weekDates(anchor: string): readonly string[] {
  const date = new Date(`${anchor}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, index) => {
    const value = new Date(date);
    value.setUTCDate(value.getUTCDate() + index);
    return value.toISOString().slice(0, 10);
  });
}

export function layoutTimedItems(
  items: readonly CalendarItem[],
  date: string,
): readonly PositionedCalendarItem[] {
  const timed = items
    .filter(
      (item) => !item.allDay && !item.deletedAt && item.startDate <= date && item.endDate >= date,
    )
    .map((item) => {
      const start = wallMinutes(item.startAt!, item.timezone, date, 0);
      const end = wallMinutes(item.endAt!, item.timezone, date, 24 * 60);
      return { item, start, end: Math.max(start + 15, end) };
    })
    .sort(
      (left, right) =>
        left.start - right.start ||
        left.end - right.end ||
        left.item.id.localeCompare(right.item.id),
    );
  const active: Array<{ end: number; column: number }> = [];
  const positioned: Array<PositionedCalendarItem & { start: number; end: number }> = [];
  for (const value of timed) {
    for (let index = active.length - 1; index >= 0; index -= 1)
      if (active[index]!.end <= value.start) active.splice(index, 1);
    const occupied = new Set(active.map((entry) => entry.column));
    let column = 0;
    while (occupied.has(column)) column += 1;
    active.push({ end: value.end, column });
    const columns = Math.max(column + 1, ...active.map((entry) => entry.column + 1));
    for (const previous of positioned)
      if (previous.end > value.start && previous.start < value.end)
        previous.columns = Math.max(previous.columns, columns);
    positioned.push({
      item: value.item,
      start: value.start,
      end: value.end,
      top: value.start,
      height: value.end - value.start,
      column,
      columns,
    });
  }
  return positioned.map(({ start: _start, end: _end, ...value }) => value);
}

function wallMinutes(
  instant: string,
  timezone: string,
  date: string,
  outsideValue: number,
): number {
  const wall = instantToZonedWallTime(instant, timezone);
  if (wall.slice(0, 10) !== date) return outsideValue;
  return Number(wall.slice(11, 13)) * 60 + Number(wall.slice(14, 16));
}
