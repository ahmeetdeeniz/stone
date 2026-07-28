import { describe, expect, it } from "vitest";
import type { CalendarItem, Project, Task } from "./entities.js";
import { buildAgendaItems, filterCalendarItems } from "./calendar-agenda.js";

function event(overrides: Partial<CalendarItem> = {}): CalendarItem {
  return {
    schemaVersion: 1,
    id: "event",
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
    projectId: "project",
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

const task = {
  id: "task",
  title: "Ship update",
  state: "open",
  dueDate: "2026-03-02",
  dueTime: "17:00",
  projectId: "project",
  sourceDocumentId: "note",
  deletedAt: null,
} as Task;

const project = {
  id: "project",
  title: "Stone",
  targetDate: "2026-03-03",
  canonicalDocumentId: "project-note",
  deletedAt: null,
} as Project;

describe("calendar filtering and agenda", () => {
  it("combines distinct event, block, due-date and milestone semantics", () => {
    const values = buildAgendaItems(
      [event(), event({ id: "block", kind: "task_block", taskId: "task", title: "Ship update" })],
      [task],
      [project],
      "2026-03-01",
      "2026-03-07",
    );
    expect(values.map((value) => value.kind)).toEqual([
      "event",
      "task_block",
      "task_due",
      "project_milestone",
    ]);
    expect(new Set(values.map((value) => value.id)).size).toBe(4);
  });

  it("filters locally by window, project, type, category, state and text", () => {
    const block = event({
      id: "block",
      kind: "task_block",
      taskId: "task",
      category: "blue",
      title: "Write release notes",
      description: "Offline work",
    });
    expect(
      filterCalendarItems(
        [event(), block],
        {
          startDate: "2026-03-01",
          endDate: "2026-03-31",
          projectId: "project",
          kind: "task_block",
          category: "blue",
          taskState: "completed",
          search: "offline",
        },
        new Map([["task", "completed"]]),
      ),
    ).toEqual([block]);
  });

  it("keeps a realistic bounded window responsive without materializing the future", () => {
    const values = Array.from({ length: 3_000 }, (_, index) =>
      event({
        id: `event-${index}`,
        title: index % 2 ? "Other" : "Needle",
        startDate: index < 1_500 ? "2026-03-02" : "2027-03-02",
        endDate: index < 1_500 ? "2026-03-02" : "2027-03-02",
      }),
    );
    const filtered = filterCalendarItems(values, {
      startDate: "2026-03-01",
      endDate: "2026-03-31",
      search: "needle",
    });
    expect(filtered).toHaveLength(750);
  });
});
