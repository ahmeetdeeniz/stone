import { describe, expect, it } from "vitest";
import type { CalendarItem } from "./entities.js";
import {
  expandCalendarOccurrences,
  exportCalendarIcs,
  importCalendarIcs,
  instantToZonedWallTime,
  validateCalendarItem,
  zonedWallTimeToInstant,
} from "./index.js";

const fixedNow = "2026-01-15T10:00:00.000Z";

function event(changes: Partial<CalendarItem> = {}): CalendarItem {
  return {
    schemaVersion: 1,
    id: "event-1",
    ownerId: "owner-1",
    revision: 1,
    createdAt: fixedNow,
    updatedAt: fixedNow,
    deletedAt: null,
    updatedByDeviceId: "device-1",
    kind: "event",
    title: "Design review",
    description: null,
    allDay: false,
    startDate: "2026-03-28",
    endDate: "2026-03-28",
    startAt: "2026-03-28T08:00:00.000Z",
    endAt: "2026-03-28T09:00:00.000Z",
    timezone: "Europe/Istanbul",
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
    ...changes,
  };
}

describe("calendar time model", () => {
  it("keeps Istanbul wall time and rejects the New York spring-forward gap", () => {
    expect(instantToZonedWallTime("2026-03-28T08:00:00.000Z", "Europe/Istanbul")).toBe(
      "2026-03-28T11:00",
    );
    expect(() =>
      zonedWallTimeToInstant("2026-03-08", "02:30", "America/New_York"),
    ).toThrow(/gap/u);
  });

  it("requires an explicit choice for a repeated fall-back hour", () => {
    expect(() =>
      zonedWallTimeToInstant("2026-11-01", "01:30", "America/New_York"),
    ).toThrow(/repeated/u);
    const earlier = zonedWallTimeToInstant(
      "2026-11-01",
      "01:30",
      "America/New_York",
      "earlier",
    );
    const later = zonedWallTimeToInstant(
      "2026-11-01",
      "01:30",
      "America/New_York",
      "later",
    );
    expect(Date.parse(later) - Date.parse(earlier)).toBe(3_600_000);
  });

  it("keeps all-day and timed storage separate", () => {
    expect(
      validateCalendarItem(
        event({
          allDay: true,
          startDate: "2026-04-01",
          endDate: "2026-04-03",
          startAt: null,
          endAt: null,
        }),
      ).endDate,
    ).toBe("2026-04-03");
    expect(() => validateCalendarItem(event({ endAt: "2026-03-28T07:00:00.000Z" }))).toThrow();
  });
});

describe("calendar recurrence", () => {
  it("expands only the requested window with stable identities and exceptions", () => {
    const source = event({
      recurrence: {
        frequency: "daily",
        interval: 1,
        unit: "day",
        preferredDayOfMonth: null,
        untilDate: "2026-04-03",
      },
      recurrenceSeriesId: "series-1",
      overrides: [
        {
          occurrenceDate: "2026-03-30",
          cancelled: true,
          title: null,
          startAt: null,
          endAt: null,
        },
        {
          occurrenceDate: "2026-03-31",
          cancelled: false,
          title: "Moved review",
          startAt: "2026-03-31T10:00:00.000Z",
          endAt: "2026-03-31T11:00:00.000Z",
        },
      ],
    });
    const values = expandCalendarOccurrences(source, "2026-03-29", "2026-04-01", 20);
    expect(values.map((value) => value.id)).toEqual([
      "series-1:2026-03-29",
      "series-1:2026-03-31",
      "series-1:2026-04-01",
    ]);
    expect(values[1]?.item.title).toBe("Moved review");
  });
});

describe("ICS subset", () => {
  it("round trips UTF-8 timed and all-day events", () => {
    const source = [
      event({ title: "Çağrı, tasarım" }),
      event({
        id: "event-2",
        title: "Release days",
        allDay: true,
        startDate: "2026-04-01",
        endDate: "2026-04-03",
        startAt: null,
        endAt: null,
      }),
    ];
    const exported = exportCalendarIcs(source);
    const imported = importCalendarIcs(exported, {
      ownerId: "owner-1",
      deviceId: "device-1",
      now: fixedNow,
      timezone: "Europe/Istanbul",
    });
    expect(imported.map((value) => value.title)).toEqual(["Çağrı, tasarım", "Release days"]);
    expect(imported[1]).toMatchObject({ allDay: true, startDate: "2026-04-01", endDate: "2026-04-03" });
  });

  it("bounds files and rejects executable-looking content as inert data", () => {
    expect(() =>
      importCalendarIcs("x".repeat(2_000_001), {
        ownerId: "owner-1",
        deviceId: "device-1",
        now: fixedNow,
        timezone: "UTC",
      }),
    ).toThrow(/too large/u);
    const parsed = importCalendarIcs(
      "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:a\r\nSUMMARY:<script>alert(1)</script>\r\nDTSTART:20260101T100000Z\r\nDTEND:20260101T110000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n",
      { ownerId: "owner-1", deviceId: "device-1", now: fixedNow, timezone: "UTC" },
    );
    expect(parsed[0]?.title).toBe("<script>alert(1)</script>");
  });
});
