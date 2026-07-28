import { describe, expect, it } from "vitest";
import { StoneMcpService } from "./core.js";
import { MemoryStoneStore } from "./store.js";
import type { AuthContext } from "./contracts.js";
import type { CalendarRecord } from "./contracts.js";

const context: AuthContext = {
  userId: "owner-1",
  clientId: "client-1",
  scopes: ["stone.read.calendar", "stone.write.calendar"],
};

describe("calendar MCP", () => {
  it("keeps scheduling separate from task due semantics and protects revisions", async () => {
    const store = new MemoryStoneStore();
    const service = new StoneMcpService(store, {
      now: () => new Date("2026-01-15T10:00:00.000Z"),
      idFactory: () => "block-1",
    });
    const created = await service.createCalendarEvent(context, {
      title: "Write release notes",
      kind: "task_block",
      taskId: "task-1",
      startDate: "2026-01-16",
      endDate: "2026-01-16",
      startAt: "2026-01-16T09:00:00.000Z",
      endAt: "2026-01-16T10:00:00.000Z",
      timezone: "Europe/Istanbul",
      expectedRevision: 0,
      idempotencyKey: "calendar-create-1",
    });
    expect(created.entity).toMatchObject({ kind: "task_block", taskId: "task-1", revision: 1 });
    const replay = await service.createCalendarEvent(context, {
      title: "Write release notes",
      kind: "task_block",
      taskId: "task-1",
      startDate: "2026-01-16",
      endDate: "2026-01-16",
      startAt: "2026-01-16T09:00:00.000Z",
      endAt: "2026-01-16T10:00:00.000Z",
      timezone: "Europe/Istanbul",
      expectedRevision: 0,
      idempotencyKey: "calendar-create-1",
    });
    expect(replay.replayed).toBe(true);
    await expect(
      service.updateCalendarEvent(context, "block-1", {
        startAt: "2026-01-16T11:00:00.000Z",
        endAt: "2026-01-16T12:00:00.000Z",
        expectedRevision: 0,
        idempotencyKey: "calendar-update-1",
      }),
    ).rejects.toMatchObject({ code: "revision_conflict" });
  });

  it("bounds date windows and scopes reads by owner", async () => {
    const service = new StoneMcpService(new MemoryStoneStore());
    await expect(
      service.listCalendarEvents(context, { startDate: "tomorrow", endDate: "2026-01-01" }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    await expect(
      service.listCalendarEvents(context, { startDate: "2026-01-01", endDate: "2028-01-01" }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(
      await service.listCalendarEvents(context, {
        startDate: "2026-01-01",
        endDate: "2026-01-31",
      }),
    ).toMatchObject({ items: [] });
    await expect(
      service.createCalendarEvent(context, {
        title: "Invalid zone",
        startDate: "2026-01-01",
        endDate: "2026-01-01",
        startAt: "2026-01-01T09:00:00.000Z",
        endAt: "2026-01-01T10:00:00.000Z",
        timezone: "Mars/Olympus",
        expectedRevision: 0,
        idempotencyKey: "invalid-zone",
      }),
    ).rejects.toThrow(/timezone/u);
  });

  it("requires explicit destructive recurrence scope and preserves unrelated occurrences", async () => {
    const store = new MemoryStoneStore();
    store.seedCalendar(recurringCalendar());
    const service = new StoneMcpService(store, {
      now: () => new Date("2026-01-15T10:00:00.000Z"),
      idFactory: () => "future-series",
    });
    await expect(
      service.deleteCalendarEvent(context, "series", {
        expectedRevision: 1,
        idempotencyKey: "calendar-delete-missing-scope",
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    const deleted = await service.deleteCalendarEvent(context, "series", {
      occurrenceDate: "2026-01-08",
      recurrenceScope: "occurrence",
      expectedRevision: 1,
      idempotencyKey: "calendar-delete-occurrence",
    });
    expect(deleted.entity).toMatchObject({
      deletedAt: null,
      overrides: [{ occurrenceDate: "2026-01-08", cancelled: true }],
    });
  });
});

function recurringCalendar(): CalendarRecord {
  return {
    id: "series",
    ownerId: "owner-1",
    schemaVersion: 1,
    kind: "event",
    title: "Weekly review",
    description: null,
    allDay: false,
    startDate: "2026-01-01",
    endDate: "2026-01-01",
    startAt: "2026-01-01T09:00:00.000Z",
    endAt: "2026-01-01T10:00:00.000Z",
    timezone: "UTC",
    location: null,
    category: "purple",
    projectId: null,
    sourceDocumentId: null,
    taskId: null,
    planningNote: null,
    recurrence: {
      frequency: "weekly",
      interval: 1,
      unit: "week",
      preferredDayOfMonth: null,
      untilDate: null,
    },
    recurrenceSeriesId: "series",
    recurrenceId: null,
    overrides: [],
    externalUid: null,
    cancelledAt: null,
    revision: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    updatedByDeviceId: "device",
  };
}
