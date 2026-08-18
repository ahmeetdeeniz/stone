import { describe, expect, it } from "vitest";
import {
  detectRevisionConflict,
  isPermanentDeletion,
  mergeTextThreeWay,
  retryDelayMs,
  SyncEngine,
  SyncRevisionConflictError,
  SyncTransportError,
  type OutboxEvent,
  type RemoteChange,
  type SyncLocalStore,
  type SyncRemote,
} from "./index.js";

describe("sync boundary", () => {
  it("distinguishes durable permanent deletion events from soft deletes", () => {
    expect(isPermanentDeletion({ operation: "delete", payload: { purge: true } })).toBe(true);
    expect(isPermanentDeletion({ operation: "delete", payload: { deletedAt: "now" } })).toBe(false);
    expect(isPermanentDeletion({ operation: "upsert", payload: { purge: true } })).toBe(false);
  });

  it("detects revision mismatches instead of applying last-write-wins", () => {
    expect(detectRevisionConflict({ baseRevision: 2, remoteRevision: 3 })).toBe(true);
    expect(detectRevisionConflict({ baseRevision: 2, remoteRevision: 2 })).toBe(false);
  });

  it("caps exponential retry delay", () => {
    expect(retryDelayMs(0)).toBe(1_000);
    expect(retryDelayMs(10)).toBe(60_000);
  });

  it("creates an explicit merge result instead of silently choosing a side", () => {
    expect(mergeTextThreeWay("base", "local", "remote")).toEqual({
      text: "<<<<<<< LOCAL\nlocal\n=======\nremote\n>>>>>>> REMOTE\n",
      hasConflicts: true,
    });
    expect(mergeTextThreeWay("base", "base", "remote")).toEqual({
      text: "remote",
      hasConflicts: false,
    });
  });

  it("acknowledges successful events and surfaces remote revision conflicts", async () => {
    const event = createEvent();
    const remoteChange = createChange();
    const acknowledged: string[] = [];
    const blocked: string[] = [];
    const local: SyncLocalStore = {
      pending: () => Promise.resolve([event]),
      acknowledgeOutbox: (id) => {
        acknowledged.push(id);
        return Promise.resolve();
      },
      deferOutbox: () => Promise.resolve(),
      blockOutbox: (id) => {
        blocked.push(id);
        return Promise.resolve();
      },
      applyRemote: () => Promise.resolve("conflict" as const),
      getCursor: () => Promise.resolve(null),
      saveCursor: () => Promise.resolve(),
      countOpenConflicts: () => Promise.resolve(0),
    };
    const remote: SyncRemote = {
      push: () => {
        throw new SyncRevisionConflictError({ remote: remoteChange });
      },
      pull: () => Promise.resolve({ changes: [], cursor: null, hasMore: false }),
    };
    const result = await new SyncEngine(remote, local).run("owner");
    expect(result).toMatchObject({ status: "conflict", conflicts: 1 });
    expect(acknowledged).toEqual([]);
    expect(blocked).toEqual([event.id]);
  });

  it("defers retryable transport failures with backoff", async () => {
    const event = createEvent();
    let deferred: [string, string, string] | undefined;
    const local: SyncLocalStore = {
      pending: () => Promise.resolve([event]),
      acknowledgeOutbox: () => Promise.resolve(),
      deferOutbox: (...args) => {
        deferred = args;
        return Promise.resolve();
      },
      blockOutbox: () => Promise.resolve(),
      applyRemote: () => Promise.resolve("ignored" as const),
      getCursor: () => Promise.resolve(null),
      saveCursor: () => Promise.resolve(),
      countOpenConflicts: () => Promise.resolve(0),
    };
    const remote: SyncRemote = {
      push: () => {
        throw new SyncTransportError("offline");
      },
      pull: () => Promise.resolve({ changes: [], cursor: null, hasMore: false }),
    };
    const result = await new SyncEngine(remote, local, {
      now: () => "2026-01-01T00:00:00.000Z",
    }).run("owner");
    expect(result).toMatchObject({ status: "offline", deferred: 1 });
    expect(deferred?.[0]).toBe(event.id);
    expect(deferred?.[2]).toBe("offline");
  });

  it("preserves a local calendar move when a remote delete conflicts", async () => {
    const moved = createEvent("calendar", "event-1", {
      startAt: "2026-01-01T11:00:00.000Z",
      endAt: "2026-01-01T12:00:00.000Z",
      deletedAt: null,
    });
    const deleted = createChange("calendar", "event-1", 2, {
      deletedAt: "2026-01-01T10:30:00.000Z",
    });
    const blocked: string[] = [];
    const conflicts: RemoteChange[] = [];
    const local = localStore([moved], {
      applyRemote: (change) => {
        conflicts.push(change);
        return Promise.resolve("conflict");
      },
      blockOutbox: (id) => {
        blocked.push(id);
        return Promise.resolve();
      },
    });
    const remote: SyncRemote = {
      pull: () => Promise.resolve({ changes: [], cursor: null, hasMore: false }),
      push: () => {
        throw new SyncRevisionConflictError({ remote: deleted });
      },
    };
    const result = await new SyncEngine(remote, local).run("owner");
    expect(result.status).toBe("conflict");
    expect(blocked).toEqual([moved.id]);
    expect(moved.payload).toMatchObject({ startAt: "2026-01-01T11:00:00.000Z" });
    expect(conflicts[0]?.payload).toMatchObject({ deletedAt: "2026-01-01T10:30:00.000Z" });
  });

  it("ignores an older calendar move delivered after a newer tombstone", async () => {
    const applied: RemoteChange[] = [];
    let revision = 0;
    const changes = [
      createChange("calendar", "event-1", 3, { deletedAt: "2026-01-03T00:00:00.000Z" }),
      createChange("calendar", "event-1", 2, { startAt: "2026-01-02T09:00:00.000Z" }),
    ];
    const local = localStore([], {
      applyRemote: (change) => {
        if (change.revision <= revision) return Promise.resolve("ignored");
        revision = change.revision;
        applied.push(change);
        return Promise.resolve("applied");
      },
    });
    const remote: SyncRemote = {
      push: () => Promise.resolve({ kind: "acknowledged", serverUpdatedAt: "" }),
      pull: () => Promise.resolve({ changes, cursor: "cursor-3", hasMore: false }),
    };
    await new SyncEngine(remote, local).run("owner");
    expect(applied).toHaveLength(1);
    expect(applied[0]).toMatchObject({ revision: 3, operation: "upsert" });
    expect(applied[0]?.payload).toHaveProperty("deletedAt");
  });

  it("syncs task completion and block movement as independent entities", async () => {
    const task = createEvent("task", "task-1", { state: "completed" });
    const block = createEvent("calendar", "block-1", {
      taskId: "task-1",
      startAt: "2026-01-01T14:00:00.000Z",
    });
    const pushed: string[] = [];
    const remote: SyncRemote = {
      pull: () => Promise.resolve({ changes: [], cursor: null, hasMore: false }),
      push: (event) => {
        pushed.push(`${event.entityType}:${event.entityId}`);
        return Promise.resolve({ kind: "acknowledged", serverUpdatedAt: "" });
      },
    };
    const result = await new SyncEngine(remote, localStore([task, block])).run("owner");
    expect(result).toMatchObject({ status: "saved", pushed: 2 });
    expect(pushed).toEqual(["task:task-1", "calendar:block-1"]);
  });
});

function createEvent(
  entityType: OutboxEvent["entityType"] = "document",
  entityId = "doc-1",
  payload: Record<string, unknown> = {},
): OutboxEvent {
  return {
    id: `${entityType}:${entityId}:2`,
    ownerId: "owner",
    entityType,
    entityId,
    operation: "upsert",
    baseRevision: 1,
    revision: 2,
    payloadVersion: 1,
    payload: { id: entityId, ownerId: "owner", revision: 2, ...payload },
    createdAt: "2026-01-01T00:00:00.000Z",
    attemptCount: 0,
    nextAttemptAt: null,
    idempotencyKey: `device:${entityType}:${entityId}:2`,
    lastError: null,
  };
}

function createChange(
  entityType: RemoteChange["entityType"] = "document",
  entityId = "doc-1",
  revision = 2,
  payload: Record<string, unknown> = {},
): RemoteChange {
  return {
    eventId: "remote-event-1",
    ownerId: "owner",
    entityType,
    entityId,
    operation: "upsert",
    revision,
    payloadVersion: 1,
    payload: { id: entityId, ownerId: "owner", revision, ...payload },
    createdAt: "2026-01-01T00:00:00.000Z",
    idempotencyKey: "remote-device:document:doc-1:2",
  };
}

function localStore(
  pending: readonly OutboxEvent[],
  overrides: Partial<SyncLocalStore> = {},
): SyncLocalStore {
  return {
    pending: () => Promise.resolve(pending),
    acknowledgeOutbox: () => Promise.resolve(),
    deferOutbox: () => Promise.resolve(),
    blockOutbox: () => Promise.resolve(),
    applyRemote: () => Promise.resolve("applied"),
    getCursor: () => Promise.resolve(null),
    saveCursor: () => Promise.resolve(),
    countOpenConflicts: () => Promise.resolve(0),
    ...overrides,
  };
}
