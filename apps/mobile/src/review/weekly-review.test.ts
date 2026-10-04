import { describe, expect, it } from "vitest";
import type { CalendarItem, FocusSession, Task } from "@stone/domain";
import { buildWeeklyReview } from "./weekly-review";

const base = {
  ownerId: "owner",
  revision: 1,
  createdAt: "2026-02-01T00:00:00.000Z",
  updatedAt: "2026-02-01T00:00:00.000Z",
  deletedAt: null,
  updatedByDeviceId: "device",
};

function task(id: string, changes: Partial<Task>): Task {
  return {
    ...base,
    schemaVersion: 1,
    id,
    title: id,
    description: null,
    state: "open",
    completedAt: null,
    dueDate: null,
    dueTime: null,
    timezone: "Europe/Istanbul",
    priority: "none",
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
    ...changes,
  };
}

function focus(id: string, startedAt: string, seconds: number): FocusSession {
  return {
    ...base,
    schemaVersion: 1,
    id,
    mode: "stopwatch",
    status: "completed",
    phase: "focus",
    startedAt,
    endedAt: new Date(Date.parse(startedAt) + seconds * 1000).toISOString(),
    plannedDurationSeconds: null,
    actualFocusSeconds: seconds,
    accumulatedPausedSeconds: 0,
    pauses: [],
    manuallyAdjustedSeconds: null,
    taskId: null,
    projectId: null,
    sourceDocumentId: null,
    calendarItemId: null,
    category: null,
    tags: [],
    note: null,
    pomodoroGroupId: null,
    pomodoroCycle: null,
    activeDeviceId: "device",
    conflictState: "none",
  };
}

const event = {
  ...base,
  schemaVersion: 1,
  id: "event-1",
  kind: "event",
  title: "Demo day",
  description: null,
  allDay: true,
  startDate: "2026-03-05",
  endDate: "2026-03-05",
  startAt: null,
  endAt: null,
  timezone: "Europe/Istanbul",
  location: null,
  category: "neutral",
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
} satisfies CalendarItem;

describe("weekly review", () => {
  it("summarises the past week and the coming one in the device timezone", () => {
    const review = buildWeeklyReview({
      today: "2026-03-02",
      timezone: "Europe/Istanbul",
      tasks: [
        // Completed 23:30 UTC on 1 March = 02:30 on 2 March in Istanbul: still this week.
        task("done", { state: "completed", completedAt: "2026-03-01T23:30:00.000Z" }),
        task("old-done", { state: "completed", completedAt: "2026-02-20T10:00:00.000Z" }),
        task("late", { dueDate: "2026-02-27" }),
        task("soon", { dueDate: "2026-03-04", dueTime: "09:00" }),
        task("sooner", { dueDate: "2026-03-03" }),
        task("far", { dueDate: "2026-03-20" }),
      ],
      focusSessions: [
        focus("f1", "2026-03-02T07:00:00.000Z", 1_500),
        focus("f2", "2026-02-25T07:00:00.000Z", 3_000),
        focus("f3", "2026-02-10T07:00:00.000Z", 9_000),
      ],
      calendarItems: [event],
    });
    expect(review.pastStart).toBe("2026-02-24");
    expect(review.nextEnd).toBe("2026-03-09");
    expect(review.completed.map((item) => item.id)).toEqual(["done"]);
    expect(review.overdue.map((item) => item.id)).toEqual(["late"]);
    expect(review.dueNextWeek.map((item) => item.id)).toEqual(["sooner", "soon"]);
    expect(review.upcomingEvents).toEqual([
      expect.objectContaining({ itemId: "event-1", title: "Demo day", date: "2026-03-05" }),
    ]);
    expect(review.focusedSeconds).toBe(4_500);
    expect(review.focusSessions).toBe(2);
    expect(review.focusByDay).toHaveLength(7);
    expect(review.focusByDay.at(-1)).toEqual({ date: "2026-03-02", seconds: 1_500 });
    expect(review.focusByDay.find((day) => day.date === "2026-02-25")?.seconds).toBe(3_000);
  });
});
