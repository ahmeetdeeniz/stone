import { describe, expect, it } from "vitest";
import type { Task } from "@stone/domain";
import { parseTaskExport } from "./task-export";

const task: Task = {
  schemaVersion: 1,
  id: "task-1",
  ownerId: "owner",
  title: "Portable",
  description: null,
  state: "open",
  completedAt: null,
  dueDate: null,
  dueTime: null,
  timezone: "UTC",
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
  revision: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
  updatedByDeviceId: "device",
};

describe("task export migration boundary", () => {
  it("round-trips valid owner-scoped tasks", () => {
    expect(
      parseTaskExport(JSON.stringify({ schema: 1, tasks: [task], occurrences: [] }), "owner"),
    ).toEqual({ schema: 1, tasks: [task], occurrences: [] });
  });

  it("rejects foreign owners, duplicate records and malformed schemas", () => {
    expect(() =>
      parseTaskExport(JSON.stringify({ schema: 1, tasks: [task], occurrences: [] }), "other"),
    ).toThrow("owner");
    expect(() =>
      parseTaskExport(JSON.stringify({ schema: 1, tasks: [task, task], occurrences: [] }), "owner"),
    ).toThrow("duplicate");
    expect(() => parseTaskExport('{"schema":99,"tasks":[],"occurrences":[]}', "owner")).toThrow(
      "schema",
    );
  });
});
