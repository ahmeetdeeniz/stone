import { describe, expect, it } from "vitest";
import type { Task } from "./entities.js";
import { compareTasks, matchesTaskList, validateTask } from "./task-logic.js";
import { createNextRecurringTask, nextOccurrenceDate, occurrenceId } from "./task-recurrence.js";

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
    dueDate: "2026-03-08",
    dueTime: "09:00",
    timezone: "America/New_York",
    priority: "medium",
    sortOrder: 0,
    tags: ["release"],
    projectId: null,
    sourceDocumentId: null,
    sourceBlockId: null,
    parentTaskId: null,
    estimatedMinutes: 30,
    recurrence: null,
    recurrenceSeriesId: null,
    occurrenceDate: null,
    revision: 1,
    deletedAt: null,
    updatedByDeviceId: "device",
    ...changes,
  };
}

describe("task domain", () => {
  it("validates constrained fields and timezone-aware due values", () => {
    expect(validateTask(task()).timezone).toBe("America/New_York");
    expect(() => validateTask(task({ dueTime: "25:90" }))).toThrow("HH:mm");
    expect(() => validateTask(task({ timezone: "Mars/Olympus" }))).toThrow("timezone");
    expect(() => validateTask(task({ state: "completed", completedAt: null }))).toThrow(
      "completion timestamp",
    );
  });

  it("filters and deterministically sorts planning views", () => {
    const overdue = task({ id: "a", dueDate: "2026-01-01", priority: "low" });
    const today = task({ id: "b", dueDate: "2026-01-02", priority: "high" });
    expect(matchesTaskList(overdue, { due: "overdue", today: "2026-01-02" })).toBe(true);
    expect(matchesTaskList(today, { due: "today", today: "2026-01-02" })).toBe(true);
    expect([today, overdue].sort(compareTasks).map((item) => item.id)).toEqual(["a", "b"]);
  });
});

describe("task recurrence", () => {
  it("preserves local calendar semantics over DST and weekdays", () => {
    expect(
      nextOccurrenceDate("2026-03-08", {
        frequency: "daily",
        interval: 1,
        unit: "day",
        preferredDayOfMonth: null,
      }),
    ).toBe("2026-03-09");
    expect(
      nextOccurrenceDate("2026-07-31", {
        frequency: "weekdays",
        interval: 1,
        unit: "day",
        preferredDayOfMonth: null,
      }),
    ).toBe("2026-08-03");
  });

  it("clamps monthly dates and creates an idempotent next occurrence", () => {
    const recurring = task({
      recurrence: {
        frequency: "monthly",
        interval: 1,
        unit: "month",
        preferredDayOfMonth: 31,
      },
      recurrenceSeriesId: "series",
      occurrenceDate: "2026-01-31",
      dueDate: "2026-01-31",
    });
    const next = createNextRecurringTask(recurring, "2026-01-31T12:00:00.000Z");
    expect(next).toMatchObject({
      id: "series:2026-02-28",
      dueDate: "2026-02-28",
      state: "open",
    });
    expect(occurrenceId("series", "2026-02-28")).toBe(next?.id);
  });
});
