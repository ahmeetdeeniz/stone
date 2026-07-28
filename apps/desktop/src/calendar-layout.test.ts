import { describe, expect, it } from "vitest";
import type { CalendarItem } from "@stone/domain";
import {
  layoutTimedItems,
  monthGrid,
  moveTimedCalendarItemToSlot,
  shiftTimedCalendarItem,
  weekDates,
} from "./calendar-layout";

function item(id: string, start: string, end: string): CalendarItem {
  return {
    schemaVersion: 1,
    id,
    ownerId: "owner",
    revision: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    updatedByDeviceId: "device",
    kind: "event",
    title: id,
    description: null,
    allDay: false,
    startDate: "2026-03-02",
    endDate: "2026-03-02",
    startAt: start,
    endAt: end,
    timezone: "UTC",
    location: null,
    category: "purple",
    projectId: null,
    sourceDocumentId: null,
    taskId: null,
    planningNote: null,
    recurrence: null,
    recurrenceSeriesId: null,
    recurrenceId: null,
    overrides: [],
    externalUid: null,
    cancelledAt: null,
  };
}

describe("desktop calendar layout", () => {
  it("builds a stable six-week Monday-first month grid", () => {
    const days = monthGrid("2026-03-15", "2026-03-02");
    expect(days).toHaveLength(42);
    expect(days[0]?.date).toBe("2026-02-23");
    expect(days.find((day) => day.isToday)?.date).toBe("2026-03-02");
  });
  it("builds the containing week", () => {
    expect(weekDates("2026-03-04")).toEqual([
      "2026-03-02",
      "2026-03-03",
      "2026-03-04",
      "2026-03-05",
      "2026-03-06",
      "2026-03-07",
      "2026-03-08",
    ]);
  });
  it("assigns simultaneous events to distinct columns", () => {
    const values = layoutTimedItems(
      [
        item("a", "2026-03-02T09:00:00.000Z", "2026-03-02T10:00:00.000Z"),
        item("b", "2026-03-02T09:30:00.000Z", "2026-03-02T11:00:00.000Z"),
        item("c", "2026-03-02T11:00:00.000Z", "2026-03-02T12:00:00.000Z"),
      ],
      "2026-03-02",
    );
    expect(values.map((value) => value.column)).toEqual([0, 1, 0]);
    expect(values[0]?.columns).toBe(2);
  });
  it("moves an overnight item while preserving duration and local dates", () => {
    const source = item("overnight", "2026-03-02T21:30:00.000Z", "2026-03-03T00:30:00.000Z");
    const moved = moveTimedCalendarItemToSlot(source, "2026-03-05", "23:00");
    expect(moved).toMatchObject({
      startDate: "2026-03-05",
      endDate: "2026-03-06",
      startAt: "2026-03-05T23:00:00.000Z",
      endAt: "2026-03-06T02:00:00.000Z",
    });
  });
  it("moves and resizes in deterministic 15-minute increments", () => {
    const shifted = shiftTimedCalendarItem(
      item("shift", "2026-03-02T09:00:00.000Z", "2026-03-02T10:00:00.000Z"),
      15,
      30,
    );
    expect(shifted.startAt).toBe("2026-03-02T09:15:00.000Z");
    expect(shifted.endAt).toBe("2026-03-02T10:30:00.000Z");
    expect(() => shiftTimedCalendarItem(shifted, 0, -90)).toThrow(/end/u);
  });
});
