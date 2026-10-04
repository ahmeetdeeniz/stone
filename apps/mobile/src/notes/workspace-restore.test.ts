import { describe, expect, it } from "vitest";
import type {
  CalendarItem,
  Document,
  Drawing,
  ExportedProjectFile,
  FocusGoal,
  FocusSession,
  Project,
  ProjectVersion,
  Task,
} from "@stone/domain";
import { createProjectMarkdown, createVersionMarkdown } from "@stone/markdown";
import {
  restoreWorkspace,
  titleFromExport,
  type WorkspaceRestoreTarget,
} from "./workspace-restore";

function fakeTarget(ownerId = "new-owner") {
  const documents = new Map<string, Document>();
  const projects = new Map<string, { project: Project; documents: readonly Document[] }>();
  const versions = new Map<string, ProjectVersion>();
  const tasks = new Map<string, Task>();
  const drawings = new Map<string, { drawing: Drawing; source: string; previewPath: string }>();
  const calendar = new Map<string, CalendarItem>();
  const focus = new Map<string, FocusSession>();
  const attachments = new Map<string, string>();
  let goal: FocusGoal | null = null;
  const target: WorkspaceRestoreTarget = {
    ownerId,
    deviceId: "device-2",
    now: "2026-05-01T00:00:00.000Z",
    getDocument: (id) => Promise.resolve(documents.get(id) ?? null),
    createDocument: (document) => Promise.resolve(documents.set(document.id, document)),
    getProject: (id) => Promise.resolve(projects.get(id)?.project ?? null),
    createProject: (project, docs) => {
      projects.set(project.id, { project, documents: docs });
      for (const document of docs) documents.set(document.id, document);
      return Promise.resolve();
    },
    getVersion: (id) => Promise.resolve(versions.get(id) ?? null),
    createVersion: (version, document) => {
      versions.set(version.id, version);
      documents.set(document.id, document);
      return Promise.resolve();
    },
    getTask: (id) => Promise.resolve(tasks.get(id) ?? null),
    createTask: (task) => Promise.resolve(tasks.set(task.id, task)),
    getDrawing: (id) => Promise.resolve(drawings.get(id)?.drawing ?? null),
    writeDrawingPreview: (id) => Promise.resolve(`file:///previews/${id}.png`),
    createDrawing: (drawing, source, previewPath) =>
      Promise.resolve(drawings.set(drawing.id, { drawing, source, previewPath })),
    writeAttachment: (fileName, base64) => {
      const created = !attachments.has(fileName);
      attachments.set(fileName, base64);
      return Promise.resolve(created);
    },
    calendar: {
      getById: (_owner, id) => Promise.resolve(calendar.get(id) ?? null),
      create: (item) => {
        calendar.set(item.id, item);
        return Promise.resolve(item);
      },
    },
    focus: {
      getById: (_owner, id) => Promise.resolve(focus.get(id) ?? null),
      create: (session) => {
        focus.set(session.id, session);
        return Promise.resolve(session);
      },
      getGoal: () => Promise.resolve(goal),
      saveGoal: (next) => {
        goal = next;
        return Promise.resolve(next);
      },
    },
    relationshipIds: () =>
      Promise.resolve({
        taskIds: new Set(tasks.keys()),
        projectIds: new Set(projects.keys()),
        documentIds: new Set(documents.keys()),
        calendarItemIds: new Set(calendar.keys()),
      }),
  };
  return { target, documents, projects, versions, tasks, drawings, calendar, attachments };
}

function exportFiles(): ExportedProjectFile[] {
  const projectMarkdown = createProjectMarkdown({
    id: "project-1",
    title: "Stone App",
    template: "mobile_app",
    status: "development",
    priority: "high",
    tags: ["mobile"],
    platforms: ["android", "ios"],
  });
  const versionMarkdown = createVersionMarkdown({
    id: "version-1",
    projectId: "project-1",
    version: "1.2.0",
  });
  const manifest = {
    schema: 2,
    ownerId: "old-owner",
    exportedAt: "2026-04-01T00:00:00.000Z",
    documents: [
      {
        id: "note-1",
        kind: "note",
        title: "Groceries",
        projectId: null,
        isPinned: true,
        revision: 7,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-02-01T00:00:00.000Z",
        path: "Notes/Groceries-note-1.md",
      },
      {
        id: "legacy-note",
        kind: "note",
        projectId: null,
        revision: 2,
        updatedAt: "2026-02-01T00:00:00.000Z",
        path: "Notes/Old-Idea-legacy-n.md",
      },
      {
        id: "project-doc",
        kind: "project",
        title: "Stone App",
        projectId: "project-1",
        revision: 4,
        updatedAt: "2026-02-01T00:00:00.000Z",
        path: "Projects/stone-app/Project.md",
      },
      {
        id: "version-doc",
        kind: "version",
        title: "v1.2.0",
        projectId: "project-1",
        revision: 3,
        updatedAt: "2026-02-01T00:00:00.000Z",
        path: "Projects/stone-app/Versions/1.2.0.md",
      },
    ],
    drawings: [
      {
        id: "drawing-1",
        documentId: "note-1",
        title: "Sketch",
        source: "assets/drawings/drawing-1.stoneink",
        preview: "assets/drawings/drawing-1.png",
      },
    ],
  };
  return [
    { path: "Notes/Groceries-note-1.md", content: "# Groceries\n\n- milk\n" },
    { path: "Notes/Old-Idea-legacy-n.md", content: "no heading here\n" },
    { path: "Projects/stone-app/Project.md", content: projectMarkdown },
    { path: "Projects/stone-app/Versions/1.2.0.md", content: versionMarkdown },
    { path: "assets/drawings/drawing-1.stoneink", content: '{"schema":1}' },
    {
      path: "assets/drawings/drawing-1.png",
      content: "iVBORw0KGgo=",
      encoding: "base64",
      mimeType: "image/png",
    },
    {
      path: "tasks.json",
      content: JSON.stringify({
        schema: 1,
        tasks: [
          {
            id: "task-1",
            schema_version: 1,
            title: "Ship",
            description: null,
            state: "open",
            completed_at: null,
            due_date: "2026-05-02",
            due_time: "09:00",
            timezone: "Europe/Istanbul",
            priority: "high",
            sort_order: 1,
            tags: '["release"]',
            project_id: "project-1",
            source_document_id: null,
            source_block_id: null,
            parent_task_id: null,
            estimated_minutes: 30,
            recurrence: null,
            recurrence_series_id: null,
            occurrence_date: null,
            revision: 9,
            created_at: "2026-01-01T00:00:00.000Z",
            updated_at: "2026-02-01T00:00:00.000Z",
            deleted_at: null,
            updated_by_device_id: "device-1",
          },
          {
            id: "deleted-task",
            title: "Gone",
            state: "open",
            deleted_at: "2026-02-01T00:00:00.000Z",
          },
        ],
        occurrences: [],
      }),
      mimeType: "application/json",
    },
    {
      path: `attachments/${"a".repeat(64)}.png`,
      content: "iVBORw0KGgo=",
      encoding: "base64",
      mimeType: "image/png",
    },
    { path: "manifest.json", content: JSON.stringify(manifest) },
  ];
}

describe("full workspace restore", () => {
  it("restores notes, projects, versions, tasks and drawings into another account", async () => {
    const fake = fakeTarget();
    const summary = await restoreWorkspace(exportFiles(), fake.target);

    expect(summary).toMatchObject({
      projects: { created: 1, duplicates: 0 },
      versions: { created: 1, duplicates: 0 },
      notes: { created: 2, duplicates: 0 },
      tasks: { created: 1, duplicates: 0 },
      drawings: { created: 1, duplicates: 0 },
      attachments: { created: 1, duplicates: 0 },
      skipped: [],
    });
    expect(fake.attachments.get(`${"a".repeat(64)}.png`)).toBe("iVBORw0KGgo=");
    const note = fake.documents.get("note-1")!;
    // Re-owned and reset to revision 1 so the owner-scoped create rules accept the sync.
    expect(note).toMatchObject({
      ownerId: "new-owner",
      revision: 1,
      title: "Groceries",
      isPinned: true,
    });
    expect(fake.documents.get("legacy-note")!.title).toBe("Old Idea");
    expect(fake.projects.get("project-1")!.project).toMatchObject({
      ownerId: "new-owner",
      canonicalDocumentId: "project-doc",
      status: "development",
      priority: "high",
      slug: "stone-app",
      revision: 1,
    });
    expect(fake.versions.get("version-1")).toMatchObject({
      projectId: "project-1",
      version: "1.2.0",
    });
    expect(fake.tasks.get("task-1")).toMatchObject({
      ownerId: "new-owner",
      revision: 1,
      tags: ["release"],
    });
    expect(fake.tasks.has("deleted-task")).toBe(false);
    expect(fake.drawings.get("drawing-1")).toMatchObject({
      drawing: { documentId: "note-1", title: "Sketch", revision: 1 },
      previewPath: "file:///previews/drawing-1.png",
    });
  });

  it("is idempotent: a second run only reports duplicates", async () => {
    const fake = fakeTarget();
    await restoreWorkspace(exportFiles(), fake.target);
    const again = await restoreWorkspace(exportFiles(), fake.target);
    expect(again).toMatchObject({
      projects: { created: 0, duplicates: 1 },
      versions: { created: 0, duplicates: 1 },
      notes: { created: 0, duplicates: 2 },
      tasks: { created: 0, duplicates: 1 },
      drawings: { created: 0, duplicates: 1 },
      attachments: { created: 0, duplicates: 1 },
    });
  });

  it("rejects exports without a supported manifest", async () => {
    await expect(restoreWorkspace([], fakeTarget().target)).rejects.toThrow("manifest.json");
    await expect(
      restoreWorkspace([{ path: "manifest.json", content: '{"schema":9}' }], fakeTarget().target),
    ).rejects.toThrow("not supported");
  });

  it("derives titles for exports made before titles were recorded", () => {
    expect(titleFromExport({ id: "abc12345-x", path: "Notes/My-Note-abc12345.md" }, "body")).toBe(
      "My Note",
    );
    expect(
      titleFromExport({ id: "x", path: "Notes/a.md" }, "---\nstone: 1\n---\n# Real title\n"),
    ).toBe("Real title");
  });
});
