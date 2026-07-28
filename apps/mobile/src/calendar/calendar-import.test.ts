import { describe, expect, it } from "vitest";
import type { CalendarItem } from "@stone/domain";
import {
  commitCalendarIcsImport,
  reviewCalendarIcsImport,
  type CalendarImportRepository,
} from "./calendar-import";

function ics(count: number): string {
  const events = Array.from(
    { length: count },
    (_, index) =>
      `BEGIN:VEVENT\r\nUID:item-${index}\r\nSUMMARY:Item ${index}\r\nDTSTART:20260302T090000Z\r\nDTEND:20260302T100000Z\r\nEND:VEVENT\r\n`,
  ).join("");
  return `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${events}END:VCALENDAR\r\n`;
}

function repository(existing: readonly CalendarItem[] = []): CalendarImportRepository {
  const values = new Map(existing.map((item) => [item.id, item]));
  return {
    getById: (_ownerId, id) => Promise.resolve(values.get(id) ?? null),
    create: (item) => {
      values.set(item.id, item);
      return Promise.resolve(item);
    },
  };
}

const context = {
  ownerId: "owner",
  deviceId: "device",
  now: "2026-01-01T00:00:00.000Z",
  timezone: "UTC",
};

describe("calendar ICS import review", () => {
  it("requires explicit confirmation before committing 100 or more events", async () => {
    const review = await reviewCalendarIcsImport(ics(100), context, repository());
    expect(review).toMatchObject({ newItems: 100, duplicates: 0, requiresConfirmation: true });
    await expect(commitCalendarIcsImport(review, repository(), false)).rejects.toThrow(
      /confirmation/u,
    );
    await expect(commitCalendarIcsImport(review, repository(), true)).resolves.toHaveLength(100);
  });

  it("deduplicates a repeated external UID before committing", async () => {
    const first = await reviewCalendarIcsImport(ics(1), context, repository());
    const store = repository(first.items);
    const repeated = await reviewCalendarIcsImport(ics(1), context, store);
    expect(repeated).toMatchObject({ newItems: 0, duplicates: 1 });
  });
});
