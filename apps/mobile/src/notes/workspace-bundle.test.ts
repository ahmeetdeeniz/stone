import { describe, expect, it } from "vitest";
import { finishFocusSession, startFocusSession, type FocusGoal } from "@stone/domain";
import {
  parseCalendarWorkspaceFile,
  parseFocusWorkspaceFile,
  parseWorkspaceBundle,
  restoreCalendarWorkspaceFile,
  restoreFocusWorkspaceFile,
  serializeWorkspaceBundle,
} from "./workspace-bundle";

describe("workspace export bundle", () => {
  it("round-trips Markdown, manifest JSON, and binary drawing previews", () => {
    const files = [
      { path: "Notes/ğüşi.md", content: "# Türkçe\n" },
      {
        path: "assets/drawings/a.png",
        content: "iVBORw==",
        encoding: "base64" as const,
        mimeType: "image/png",
      },
      { path: "manifest.json", content: '{"schema":1}' },
    ];
    expect(parseWorkspaceBundle(serializeWorkspaceBundle(files))).toEqual([
      { ...files[0], encoding: "utf8", mimeType: "text/markdown" },
      files[1],
      { ...files[2], encoding: "utf8", mimeType: "text/plain" },
    ]);
  });

  it("validates owner-scoped calendar restore data and duplicate identities", () => {
    const item = {
      schemaVersion: 1,
      id: "event-1",
      ownerId: "owner-1",
      revision: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      deletedAt: null,
      updatedByDeviceId: "device-1",
      kind: "event",
      title: "Planning",
      description: null,
      allDay: true,
      startDate: "2026-01-02",
      endDate: "2026-01-02",
      startAt: null,
      endAt: null,
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
    };
    expect(
      parseCalendarWorkspaceFile(JSON.stringify({ schema: 1, items: [item] }), "owner-1"),
    ).toHaveLength(1);
    expect(() =>
      parseCalendarWorkspaceFile(JSON.stringify({ schema: 1, items: [item, item] }), "owner-1"),
    ).toThrow(/duplicate/u);
    expect(() =>
      parseCalendarWorkspaceFile(JSON.stringify({ schema: 1, items: [item] }), "owner-2"),
    ).toThrow(/foreign/u);
  });

  it("restores calendar data idempotently and detaches missing relationships", async () => {
    const item = calendarItem();
    const stored = new Map<string, typeof item>();
    const repository = {
      getById: (_ownerId: string, id: string) => Promise.resolve(stored.get(id) ?? null),
      create: (value: typeof item) => {
        stored.set(value.id, value);
        return Promise.resolve(value);
      },
    };
    const source = JSON.stringify({ schema: 1, items: [item] });
    await expect(
      restoreCalendarWorkspaceFile(source, "owner-1", repository, {
        taskIds: new Set(),
        projectIds: new Set(),
        documentIds: new Set(),
      }),
    ).resolves.toEqual({ created: 1, duplicates: 0, detachedRelationships: 3 });
    expect(stored.get(item.id)).toMatchObject({
      taskId: null,
      projectId: null,
      sourceDocumentId: null,
    });
    await expect(
      restoreCalendarWorkspaceFile(source, "owner-1", repository, {
        taskIds: new Set(),
        projectIds: new Set(),
        documentIds: new Set(),
      }),
    ).resolves.toEqual({ created: 0, duplicates: 1, detachedRelationships: 0 });
  });

  it("writes schema v3 while continuing to import legacy v1 bundles", () => {
    const serialized = serializeWorkspaceBundle([
      { path: "tasks.json", content: '{"schema":1,"tasks":[],"occurrences":[]}' },
    ]);
    expect(JSON.parse(serialized)).toMatchObject({ schema: 3, format: "stone-workspace" });
    expect(
      parseWorkspaceBundle(
        '{"schema":1,"format":"stone-workspace","files":[{"path":"Notes/old.md","content":"# Old","encoding":"utf8","mimeType":"text/markdown"}]}',
      ),
    ).toHaveLength(1);
  });

  it("validates and restores focus data idempotently while detaching missing links", async () => {
    const started = startFocusSession(
      {
        id: "focus-restore",
        ownerId: "owner-1",
        deviceId: "device-1",
        mode: "countdown",
        plannedDurationSeconds: 1_500,
        taskId: "missing-task",
        projectId: "missing-project",
        sourceDocumentId: "missing-note",
        calendarItemId: "missing-block",
      },
      { now: () => "2026-01-02T09:00:00.000Z" },
    );
    const session = finishFocusSession(started, {
      now: () => "2026-01-02T09:25:00.000Z",
    });
    const goal: FocusGoal = {
      id: "owner-1",
      ownerId: "owner-1",
      schemaVersion: 1,
      timezone: "Europe/Istanbul",
      dailyMinutes: 60,
      weeklyMinutes: 300,
      effectiveFromDate: "2026-01-02",
      streakVisible: false,
      revision: 1,
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
      deletedAt: null,
      updatedByDeviceId: "device-1",
    };
    const source = JSON.stringify({ schema: 1, sessions: [session], goal });
    expect(parseFocusWorkspaceFile(source, "owner-1").sessions).toHaveLength(1);
    expect(() => parseFocusWorkspaceFile(source, "owner-2")).toThrow(/foreign/u);
    const sessions = new Map<string, typeof session>();
    let storedGoal: FocusGoal | null = null;
    const repository = {
      getById: (_ownerId: string, id: string) => Promise.resolve(sessions.get(id) ?? null),
      create: (value: typeof session) => {
        sessions.set(value.id, value);
        return Promise.resolve(value);
      },
      getGoal: () => Promise.resolve(storedGoal),
      saveGoal: (value: FocusGoal) => {
        storedGoal = value;
        return Promise.resolve(value);
      },
    };
    await expect(
      restoreFocusWorkspaceFile(source, "owner-1", repository, {
        taskIds: new Set(),
        projectIds: new Set(),
        documentIds: new Set(),
        calendarItemIds: new Set(),
      }),
    ).resolves.toEqual({ created: 1, duplicates: 0, detachedRelationships: 4 });
    expect(sessions.get(session.id)).toMatchObject({
      taskId: null,
      projectId: null,
      sourceDocumentId: null,
      calendarItemId: null,
    });
    await expect(
      restoreFocusWorkspaceFile(source, "owner-1", repository, {
        taskIds: new Set(),
        projectIds: new Set(),
        documentIds: new Set(),
        calendarItemIds: new Set(),
      }),
    ).resolves.toEqual({ created: 0, duplicates: 1, detachedRelationships: 0 });
  });

  it("rejects traversal, duplicate paths, invalid binary content, and unknown schemas", () => {
    expect(() => serializeWorkspaceBundle([{ path: "../secret", content: "" }])).toThrow(
      "unsafe path",
    );
    expect(() =>
      serializeWorkspaceBundle([
        { path: "Notes/a.md", content: "" },
        { path: "Notes/a.md", content: "" },
      ]),
    ).toThrow("duplicate path");
    expect(() =>
      serializeWorkspaceBundle([{ path: "a.png", content: "***", encoding: "base64" }]),
    ).toThrow("invalid base64");
    expect(() =>
      parseWorkspaceBundle('{"schema":4,"format":"stone-workspace","files":[]}'),
    ).toThrow("schema is not supported");
  });
});

function calendarItem() {
  return {
    schemaVersion: 1 as const,
    id: "event-restore",
    ownerId: "owner-1",
    revision: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    updatedByDeviceId: "device-1",
    kind: "task_block" as const,
    title: "Planning",
    description: null,
    allDay: false,
    startDate: "2026-01-02",
    endDate: "2026-01-02",
    startAt: "2026-01-02T09:00:00.000Z",
    endAt: "2026-01-02T10:00:00.000Z",
    timezone: "Europe/Istanbul",
    location: null,
    category: "blue" as const,
    projectId: "missing-project",
    sourceDocumentId: "missing-note",
    taskId: "missing-task",
    planningNote: null,
    recurrence: null,
    recurrenceSeriesId: null,
    recurrenceId: null,
    overrides: [],
    externalUid: null,
    cancelledAt: null,
  };
}
