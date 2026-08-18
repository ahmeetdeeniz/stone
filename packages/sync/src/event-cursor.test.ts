import { describe, expect, it } from "vitest";
import {
  compareSyncEventCursors,
  decodeSyncEventCursor,
  encodeSyncEventCursor,
  SyncEngine,
  SyncTransportError,
  type RemoteChange,
  type SyncEventCursor,
  type SyncLocalStore,
  type SyncRemote,
} from "./index.js";

describe("server-ordered sync event cursors", () => {
  it("round-trips the full server timestamp and deterministic tie-breaker", () => {
    const cursor: SyncEventCursor = {
      serverUpdatedAtSeconds: 1_769_876_543,
      serverUpdatedAtNanoseconds: 987_654_321,
      eventId: "event-z",
    };
    expect(decodeSyncEventCursor(encodeSyncEventCursor(cursor))).toEqual(cursor);
    expect(decodeSyncEventCursor("legacy-event-id")).toBeNull();
  });

  it("orders equal timestamps by eventId, independent of creation order", () => {
    const first = cursor("event-a", 100, 20);
    const second = cursor("event-b", 100, 20);
    expect(compareSyncEventCursors(first, second)).toBeLessThan(0);
    expect(compareSyncEventCursors(second, first)).toBeGreaterThan(0);
  });

  it("does not miss a later event whose ID sorts before the cursor event", async () => {
    const events = [stored("event-z", 100), stored("event-a", 200), stored("event-m", 300)];
    const local = createLocalStore();
    const result = await new SyncEngine(new OrderedRemote(events), local, { pageSize: 1 }).run(
      "owner",
    );

    expect(result).toMatchObject({ status: "saved", pulled: 3 });
    expect(local.applied).toEqual(["event-z", "event-a", "event-m"]);
  });

  it("does not duplicate or skip events at page boundaries", async () => {
    const events = [stored("event-1", 100), stored("event-2", 100), stored("event-3", 100)];
    const local = createLocalStore();
    await new SyncEngine(new OrderedRemote(events), local, { pageSize: 2 }).run("owner");

    expect(local.applied).toEqual(["event-1", "event-2", "event-3"]);
    expect(new Set(local.applied).size).toBe(3);
  });

  it("persists the cursor before reconnecting after a later page fails", async () => {
    const events = [stored("event-1", 100), stored("event-2", 200), stored("event-3", 300)];
    const local = createLocalStore();
    const remote = new OrderedRemote(events, 2);

    await expect(
      new SyncEngine(remote, local, { pageSize: 1 }).run("owner"),
    ).resolves.toMatchObject({
      status: "offline",
      pulled: 0,
    });
    expect(local.applied).toEqual(["event-1"]);
    expect(decodeSyncEventCursor(local.cursor)?.eventId).toBe("event-1");

    remote.failOnPull = null;
    await new SyncEngine(remote, local, { pageSize: 1 }).run("owner");
    expect(local.applied).toEqual(["event-1", "event-2", "event-3"]);
  });

  it("does not persist a page cursor when applying that page fails", async () => {
    const events = [stored("event-1", 100), stored("event-delete", 200)];
    const local = createLocalStore();
    local.failOnEventId = "event-delete";
    await expect(
      new SyncEngine(new OrderedRemote(events), local, { pageSize: 2 }).run("owner"),
    ).rejects.toThrow("apply failed");
    expect(local.cursor).toBeNull();

    local.failOnEventId = null;
    await new SyncEngine(new OrderedRemote(events), local, { pageSize: 2 }).run("owner");
    expect(local.applied).toEqual(["event-1", "event-1", "event-delete"]);
  });

  it("keeps tombstone events in the same lossless order", async () => {
    const tombstone = stored("event-purge", 200, "delete");
    const local = createLocalStore();
    await new SyncEngine(new OrderedRemote([stored("event-upsert", 100), tombstone]), local, {
      pageSize: 1,
    }).run("owner");
    expect(local.operations).toEqual(["upsert", "delete"]);
  });

  it("replays a legacy eventId cursor instead of guessing its timestamp", async () => {
    const local = createLocalStore("does-not-encode-a-timestamp");
    await new SyncEngine(
      new OrderedRemote([stored("event-z", 100), stored("event-a", 200)]),
      local,
      { pageSize: 2 },
    ).run("owner");
    expect(local.applied).toEqual(["event-z", "event-a"]);
  });
});

interface StoredEvent {
  cursor: SyncEventCursor;
  change: RemoteChange;
}

class OrderedRemote implements SyncRemote {
  public failOnPull: number | null;
  private pulls = 0;

  public constructor(
    private readonly events: readonly StoredEvent[],
    failOnPull: number | null = null,
  ) {
    this.failOnPull = failOnPull;
  }

  public push() {
    return Promise.resolve({ kind: "acknowledged" as const, serverUpdatedAt: "" });
  }

  public pull(_ownerId: string, rawCursor: string | null, limit: number) {
    this.pulls += 1;
    if (this.failOnPull === this.pulls) {
      throw new SyncTransportError("reconnect required");
    }
    const decoded = decodeSyncEventCursor(rawCursor);
    const start = decoded
      ? this.events.findIndex((event) => compareSyncEventCursors(event.cursor, decoded) > 0)
      : 0;
    const offset = start === -1 ? this.events.length : start;
    const page = this.events.slice(offset, offset + limit);
    const last = page.at(-1);
    return Promise.resolve({
      changes: page.map((event) => event.change),
      cursor: last ? encodeSyncEventCursor(last.cursor) : rawCursor,
      hasMore: offset + page.length < this.events.length,
    });
  }
}

function createLocalStore(initialCursor: string | null = null): TestLocalStore {
  return new TestLocalStore(initialCursor);
}

class TestLocalStore implements SyncLocalStore {
  public readonly applied: string[] = [];
  public readonly operations: string[] = [];
  public cursor: string | null;
  public failOnEventId: string | null = null;

  public constructor(cursor: string | null) {
    this.cursor = cursor;
  }

  public pending() {
    return Promise.resolve([]);
  }

  public acknowledgeOutbox() {
    return Promise.resolve();
  }

  public deferOutbox() {
    return Promise.resolve();
  }

  public blockOutbox() {
    return Promise.resolve();
  }

  public applyRemote(change: RemoteChange) {
    if (change.eventId === this.failOnEventId) throw new Error("apply failed");
    this.applied.push(change.eventId);
    this.operations.push(change.operation);
    return Promise.resolve("applied" as const);
  }

  public getCursor() {
    return Promise.resolve(this.cursor);
  }

  public saveCursor(_ownerId: string, cursor: string) {
    this.cursor = cursor;
    return Promise.resolve();
  }

  public countOpenConflicts() {
    return Promise.resolve(0);
  }
}

function stored(
  eventId: string,
  seconds: number,
  operation: RemoteChange["operation"] = "upsert",
): StoredEvent {
  return {
    cursor: cursor(eventId, seconds),
    change: {
      eventId,
      ownerId: "owner",
      entityType: "document",
      entityId: eventId,
      operation,
      revision: seconds / 100,
      payloadVersion: 1,
      payload: { id: eventId, ownerId: "owner", revision: seconds / 100 },
      createdAt: new Date(seconds * 1_000).toISOString(),
      idempotencyKey: `device:${eventId}`,
    },
  };
}

function cursor(eventId: string, seconds: number, nanoseconds = 0): SyncEventCursor {
  return {
    serverUpdatedAtSeconds: seconds,
    serverUpdatedAtNanoseconds: nanoseconds,
    eventId,
  };
}
