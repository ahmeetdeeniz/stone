import { describe, expect, it } from "vitest";
import type { CalendarItem, Task } from "./entities.js";
import {
  DEFAULT_REMINDER_SETTINGS,
  diffReminders,
  MAX_SCHEDULED_REMINDERS,
  parseReminderSettings,
  planReminders,
} from "./reminders.js";

function task(changes: Partial<Task> = {}): Task {
  return {
    schemaVersion: 1,
    id: "task-1",
    ownerId: "owner",
    title: "Write release notes",
    description: null,
    state: "open",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    completedAt: null,
    dueDate: "2026-03-02",
    dueTime: "17:00",
    timezone: "Europe/Istanbul",
    priority: "medium",
    sortOrder: 0,
    tags: [],
    projectId: null,
    sourceDocumentId: null,
    sourceBlockId: null,
    parentTaskId: null,
    estimatedMinutes: null,
    recurrence: null,
    recurrenceSeriesId: null,
    occurrenceDate: null,
    revision: 1,
    deletedAt: null,
    updatedByDeviceId: "device",
    ...changes,
  };
}

function event(overrides: Partial<CalendarItem> = {}): CalendarItem {
  return {
    schemaVersion: 1,
    id: "event-1",
    ownerId: "owner",
    revision: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    updatedByDeviceId: "device",
    kind: "event",
    title: "Planning",
    description: null,
    allDay: false,
    startDate: "2026-03-02",
    endDate: "2026-03-02",
    startAt: "2026-03-02T09:00:00.000Z",
    endAt: "2026-03-02T10:00:00.000Z",
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
    ...overrides,
  };
}

const now = new Date("2026-03-01T12:00:00.000Z");
const settings = DEFAULT_REMINDER_SETTINGS;

describe("reminder planning", () => {
  it("reminds before timed tasks in their own timezone and at the all-day time otherwise", () => {
    const planned = planReminders({
      tasks: [task(), task({ id: "task-2", dueTime: null })],
      calendarItems: [],
      now,
      settings,
    });
    // 17:00 Istanbul (UTC+3) is 14:00Z; 15 minutes earlier is 13:45Z.
    expect(planned.find((item) => item.entityId === "task-1")).toMatchObject({
      fireAt: "2026-03-02T13:45:00.000Z",
      dueAt: "2026-03-02T14:00:00.000Z",
      allDay: false,
    });
    // Date-only: 09:00 Istanbul, no lead time.
    expect(planned.find((item) => item.entityId === "task-2")).toMatchObject({
      fireAt: "2026-03-02T06:00:00.000Z",
      allDay: true,
    });
  });

  it("skips completed, deleted, undated and past tasks", () => {
    const planned = planReminders({
      tasks: [
        task({ state: "completed" }),
        task({ id: "deleted", deletedAt: "2026-02-01T00:00:00.000Z" }),
        task({ id: "undated", dueDate: null, dueTime: null }),
        task({ id: "past", dueDate: "2026-02-01" }),
      ],
      calendarItems: [],
      now,
      settings,
    });
    expect(planned).toEqual([]);
  });

  it("plans calendar events and their recurrences inside the window", () => {
    const planned = planReminders({
      tasks: [],
      calendarItems: [
        event({
          recurrence: {
            frequency: "daily",
            interval: 1,
            unit: "day",
            preferredDayOfMonth: null,
            untilDate: "2026-03-04",
          },
          recurrenceSeriesId: "series-1",
        }),
        event({ id: "cancelled", cancelledAt: "2026-02-01T00:00:00.000Z" }),
      ],
      now,
      settings,
    });
    expect(planned.map((item) => item.fireAt)).toEqual([
      "2026-03-02T08:45:00.000Z",
      "2026-03-03T08:45:00.000Z",
      "2026-03-04T08:45:00.000Z",
    ]);
    expect(new Set(planned.map((item) => item.id)).size).toBe(3);
  });

  it("respects the disabled setting and the scheduling cap", () => {
    expect(
      planReminders({
        tasks: [task()],
        calendarItems: [],
        now,
        settings: { ...settings, enabled: false },
      }),
    ).toEqual([]);
    const many = Array.from({ length: 80 }, (_, index) =>
      task({ id: `task-${index}`, dueDate: "2026-03-05" }),
    );
    expect(planReminders({ tasks: many, calendarItems: [], now, settings })).toHaveLength(
      MAX_SCHEDULED_REMINDERS,
    );
  });

  it("diffs pending notifications against the plan", () => {
    const planned = planReminders({ tasks: [task()], calendarItems: [], now, settings });
    const keep = planned[0]!.id;
    expect(diffReminders([keep, "task:old:2026"], planned)).toEqual({
      cancel: ["task:old:2026"],
      schedule: [],
    });
    expect(diffReminders([], planned).schedule).toHaveLength(1);
  });

  it("parses stored settings defensively", () => {
    expect(parseReminderSettings(null)).toEqual(DEFAULT_REMINDER_SETTINGS);
    expect(parseReminderSettings({ enabled: false, leadMinutes: 30, allDayTime: "08:30" })).toEqual(
      {
        enabled: false,
        leadMinutes: 30,
        allDayTime: "08:30",
      },
    );
    expect(parseReminderSettings({ leadMinutes: 7, allDayTime: "25:00" })).toEqual(
      DEFAULT_REMINDER_SETTINGS,
    );
  });
});
