import { describe, expect, it } from "vitest";
import {
  detectRevisionConflict,
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
});

function createEvent(): OutboxEvent {
  return {
    id: "event-1",
    ownerId: "owner",
    entityType: "document",
    entityId: "doc-1",
    operation: "upsert",
    baseRevision: 1,
    revision: 2,
    payloadVersion: 1,
    payload: { id: "doc-1", ownerId: "owner", revision: 2 },
    createdAt: "2026-01-01T00:00:00.000Z",
    attemptCount: 0,
    nextAttemptAt: null,
    idempotencyKey: "device:document:doc-1:2",
    lastError: null,
  };
}

function createChange(): RemoteChange {
  return {
    eventId: "remote-event-1",
    ownerId: "owner",
    entityType: "document",
    entityId: "doc-1",
    operation: "upsert",
    revision: 2,
    payloadVersion: 1,
    payload: { id: "doc-1", ownerId: "owner", revision: 2 },
    createdAt: "2026-01-01T00:00:00.000Z",
    idempotencyKey: "remote-device:document:doc-1:2",
  };
}
