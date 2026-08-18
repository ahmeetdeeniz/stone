import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { serverTimestamp } from "firebase/firestore";
import { afterAll, beforeAll, describe, it } from "vitest";

describe("Firestore owner isolation rules", () => {
  let environment: RulesTestEnvironment;

  beforeAll(async () => {
    environment = await initializeTestEnvironment({
      projectId: "demo-stone",
      firestore: {
        rules: readFileSync(resolve(process.cwd(), "firestore.rules"), "utf8"),
      },
    });
  });

  afterAll(async () => {
    await environment.cleanup();
  });

  it("allows only the owner and enforces monotonic entity revisions", async () => {
    const owner = environment.authenticatedContext("owner").firestore();
    const other = environment.authenticatedContext("other").firestore();
    const reference = owner.doc("users/owner/documents/note-1");
    const document = {
      id: "note-1",
      ownerId: "owner",
      kind: "note",
      title: "Local",
      markdown: "# Local",
      path: null,
      projectId: null,
      isPinned: false,
      revision: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      deletedAt: null,
      updatedByDeviceId: "device-1",
      idempotencyKey: "device:document:note-1:1",
      lastEventId: "device:document:note-1:1",
    };

    await assertSucceeds(reference.set(document));
    await assertSucceeds(reference.get());
    await assertFails(other.doc(reference.path).get());
    await assertSucceeds(reference.update({ ownerId: "owner", revision: 2 }));
    await assertFails(reference.update({ ownerId: "owner", revision: 4 }));
    await assertFails(reference.update({ ownerId: "other", revision: 3 }));
    await assertFails(reference.set({ ...document, revision: 3, debug: true }));
  });

  it("allows owner-scoped immutable sync events and rejects foreign events", async () => {
    const owner = environment.authenticatedContext("owner").firestore();
    const other = environment.authenticatedContext("other").firestore();
    const event = {
      eventId: "event-1",
      ownerId: "owner",
      entityId: "note-1",
      entityType: "document",
      operation: "upsert",
      revision: 1,
      payloadVersion: 1,
      payload: {},
      createdAt: "2026-01-01T00:00:00.000Z",
      idempotencyKey: "device:document:note-1:1",
      serverUpdatedAt: serverTimestamp(),
    };
    await assertSucceeds(owner.doc("users/owner/syncEvents/event-1").set(event));
    await assertFails(owner.doc("users/owner/syncEvents/event-1").update({ revision: 2 }));
    await assertFails(
      other.doc("users/owner/syncEvents/event-2").set({ ...event, eventId: "event-2" }),
    );
  });

  it("protects deletion tombstones and drawing cleanup markers by owner and revision", async () => {
    const owner = environment.authenticatedContext("owner").firestore();
    const other = environment.authenticatedContext("other").firestore();
    const tombstone = owner.doc("users/owner/deletionTombstones/document:purged-note");
    const tombstoneData = {
      id: "document:purged-note",
      ownerId: "owner",
      entityType: "document",
      entityId: "purged-note",
      revision: 2,
      deletedAt: "2026-08-01T00:00:00.000Z",
      createdAt: "2026-08-01T00:00:00.000Z",
      sourceEventId: "purge-event",
      cascadeDrawingIds: ["drawing-1"],
    };
    await assertSucceeds(tombstone.set(tombstoneData));
    await assertSucceeds(tombstone.update({ ...tombstoneData, revision: 3 }));
    await assertFails(tombstone.update({ ...tombstoneData, revision: 2 }));
    await assertFails(other.doc(tombstone.path).get());
    await assertFails(tombstone.set({ ...tombstoneData, revision: 4, debug: true }));

    const marker = owner.doc("users/owner/drawingOperations/delete:drawing-1");
    const markerData = {
      id: "delete:drawing-1",
      ownerId: "owner",
      operation: "delete",
      drawingId: "drawing-1",
      revision: 3,
      sourceStoragePath: "",
      previewStoragePath: "",
      state: "pending",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: serverTimestamp(),
    };
    await assertSucceeds(marker.set(markerData));
    await assertSucceeds(
      marker.update({ ...markerData, state: "committed", updatedAt: serverTimestamp() }),
    );
    await assertFails(other.doc(marker.path).get());
    await assertFails(marker.set({ ...markerData, revision: 4, debug: true }));
  });

  it("enforces owner identity and revisions for devices and settings", async () => {
    const owner = environment.authenticatedContext("owner").firestore();
    const device = owner.doc("users/owner/devices/device-1");
    await assertSucceeds(
      device.set({
        id: "device-1",
        ownerId: "owner",
        platform: "android",
        name: "Test device",
        appVersion: "0.1.0",
        lastSeenAt: "2026-01-01T00:00:00.000Z",
        revision: 1,
        idempotencyKey: "device-1:device:1",
        lastEventId: "device-1:device:1",
      }),
    );
    await assertFails(device.update({ id: "device-1", ownerId: "owner", revision: 3 }));
    await assertSucceeds(
      device.update({
        id: "device-1",
        ownerId: "owner",
        platform: "android",
        name: "Test device",
        appVersion: "0.1.0",
        lastSeenAt: "2026-01-01T00:00:00.000Z",
        revision: 2,
        idempotencyKey: "device-1:device:2",
        lastEventId: "device-1:device:2",
      }),
    );

    const settings = owner.doc("users/owner/settings/owner");
    await assertSucceeds(
      settings.set({
        id: "owner",
        ownerId: "owner",
        theme: "system",
        reduceMotion: false,
        editorFontSize: 17,
        trashRetentionDays: 30,
        revision: 1,
        idempotencyKey: "owner:settings:1",
        lastEventId: "owner:settings:1",
      }),
    );
    await assertFails(settings.update({ id: "owner", ownerId: "owner", revision: 1 }));
  });

  it("rejects malformed project and version payloads", async () => {
    const owner = environment.authenticatedContext("owner").firestore();
    const project = owner.doc("users/owner/projects/project-1");
    await assertFails(project.set({ id: "project-1", ownerId: "owner", revision: 1 }));
    const version = owner.doc("users/owner/versions/version-1");
    await assertFails(version.set({ id: "version-1", ownerId: "owner", revision: 1 }));
  });

  it("isolates versioned task records by owner and rejects malformed fields", async () => {
    const owner = environment.authenticatedContext("owner").firestore();
    const other = environment.authenticatedContext("other").firestore();
    const reference = owner.doc("users/owner/tasks/task-1");
    const task = {
      id: "task-1",
      ownerId: "owner",
      schemaVersion: 1,
      title: "Ship Stone",
      description: null,
      state: "open",
      completedAt: null,
      dueDate: "2026-08-01",
      dueTime: "09:00",
      timezone: "Europe/Istanbul",
      priority: "high",
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
      createdAt: "2026-07-28T00:00:00.000Z",
      updatedAt: "2026-07-28T00:00:00.000Z",
      deletedAt: null,
      updatedByDeviceId: "device",
      idempotencyKey: "device:task:task-1:1",
      lastEventId: "device:task:task-1:1",
    };
    await assertSucceeds(reference.set(task));
    await assertFails(other.doc(reference.path).get());
    await assertSucceeds(
      reference.update({
        ...task,
        revision: 2,
        state: "completed",
        completedAt: "2026-07-28T01:00:00.000Z",
      }),
    );
    await assertFails(reference.update({ ...task, revision: 3, priority: "critical" }));
    await assertFails(other.doc("users/other/tasks/task-2").set({ ...task, id: "task-2" }));
  });

  it("isolates calendar records by owner and constrains relationships", async () => {
    const owner = environment.authenticatedContext("owner").firestore();
    const other = environment.authenticatedContext("other").firestore();
    const reference = owner.doc("users/owner/calendar/event-1");
    const event = {
      id: "event-1",
      ownerId: "owner",
      schemaVersion: 1,
      kind: "event",
      title: "Planning",
      description: null,
      allDay: false,
      startDate: "2026-08-01",
      endDate: "2026-08-01",
      startAt: "2026-08-01T09:00:00.000Z",
      endAt: "2026-08-01T10:00:00.000Z",
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
      revision: 1,
      createdAt: "2026-07-28T00:00:00.000Z",
      updatedAt: "2026-07-28T00:00:00.000Z",
      deletedAt: null,
      updatedByDeviceId: "device",
      idempotencyKey: "device:calendar:event-1:1",
      lastEventId: "device:calendar:event-1:1",
    };
    await assertSucceeds(reference.set(event));
    await assertFails(other.doc(reference.path).get());
    await assertSucceeds(reference.update({ ...event, revision: 2, title: "Moved planning" }));
    await assertFails(reference.update({ ...event, revision: 3, category: "pink" }));
    await assertFails(other.doc("users/owner/calendar/event-2").set({ ...event, id: "event-2" }));
  });

  it("isolates focus sessions and goals with constrained lifecycle data", async () => {
    const owner = environment.authenticatedContext("owner").firestore();
    const other = environment.authenticatedContext("other").firestore();
    const reference = owner.doc("users/owner/focusSessions/focus-1");
    const session = {
      id: "focus-1",
      ownerId: "owner",
      schemaVersion: 1,
      mode: "countdown",
      status: "running",
      phase: "focus",
      startedAt: "2026-07-29T09:00:00.000Z",
      endedAt: null,
      plannedDurationSeconds: 1500,
      actualFocusSeconds: 0,
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
      activeDeviceId: "device-1",
      conflictState: "none",
      revision: 1,
      createdAt: "2026-07-29T09:00:00.000Z",
      updatedAt: "2026-07-29T09:00:00.000Z",
      deletedAt: null,
      updatedByDeviceId: "device-1",
      idempotencyKey: "device-1:focus:focus-1:1",
      lastEventId: "device-1:focus:focus-1:1",
    };
    await assertSucceeds(reference.set(session));
    await assertFails(other.doc(reference.path).get());
    await assertSucceeds(reference.update({ ...session, status: "paused", revision: 2 }));
    await assertFails(reference.update({ ...session, mode: "invalid", revision: 3 }));

    const goal = owner.doc("users/owner/focusGoals/owner");
    await assertSucceeds(
      goal.set({
        id: "owner",
        ownerId: "owner",
        schemaVersion: 1,
        timezone: "Europe/Istanbul",
        dailyMinutes: 60,
        weeklyMinutes: 300,
        effectiveFromDate: "2026-07-29",
        streakVisible: false,
        revision: 1,
        createdAt: "2026-07-29T00:00:00.000Z",
        updatedAt: "2026-07-29T00:00:00.000Z",
        deletedAt: null,
        updatedByDeviceId: "device-1",
        idempotencyKey: "device-1:focus_goal:owner:1",
        lastEventId: "device-1:focus_goal:owner:1",
      }),
    );
    await assertFails(other.doc(goal.path).get());
  });
});
