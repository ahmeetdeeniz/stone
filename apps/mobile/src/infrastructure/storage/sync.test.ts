import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RemoteChange } from "@stone/sync";
import { migrations } from "./migrations";
import type { StoneDatabase } from "./database";

const deletedFiles: string[] = [];

vi.mock("expo-file-system", () => ({
  File: class {
    public readonly exists = true;
    public constructor(private readonly path: string) {}
    public delete(): void {
      deletedFiles.push(this.path);
    }
  },
}));

const databases: DatabaseSync[] = [];

describe("SQLite sync tombstones", () => {
  beforeEach(() => {
    for (const database of databases.splice(0)) database.close();
    deletedFiles.splice(0);
  });

  it("purges local rows, clears stale outbox entries, and blocks resurrection", async () => {
    const raw = new DatabaseSync(":memory:");
    databases.push(raw);
    applyMigrations(raw);
    const database = asStoneDatabase(raw);
    await database.runAsync(
      "INSERT INTO documents (id, owner_id, kind, title, markdown, is_pinned, revision, created_at, updated_at, updated_by_device_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      "note-1",
      "owner-1",
      "note",
      "Local",
      "# Local",
      0,
      2,
      "2026-08-01T00:00:00.000Z",
      "2026-08-01T00:00:00.000Z",
      "device-1",
    );
    await database.runAsync(
      "INSERT INTO drawings (id, owner_id, document_id, title, source_path, preview_path, source_sha256, preview_sha256, source_size, preview_size, revision, created_at, updated_at, updated_by_device_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      "drawing-1",
      "owner-1",
      "note-1",
      "Sketch",
      "file:///source.stoneink",
      "file:///preview.png",
      "source",
      "preview",
      1,
      1,
      3,
      "2026-08-01T00:00:00.000Z",
      "2026-08-01T00:00:00.000Z",
      "device-1",
    );
    await database.runAsync(
      "INSERT INTO drawing_revisions (id, drawing_id, revision, source_path, preview_path, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      "drawing-1:2",
      "drawing-1",
      2,
      "file:///source-old.stoneink",
      "file:///preview-old.png",
      "2026-07-31T00:00:00.000Z",
    );
    await database.runAsync(
      "INSERT INTO outbox (id, entity_type, entity_id, operation, base_revision, payload_version, payload, created_at, idempotency_key, owner_id, revision, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      "pending-note",
      "document",
      "note-1",
      "upsert",
      2,
      1,
      JSON.stringify({ id: "note-1" }),
      "2026-08-01T00:00:00.000Z",
      "pending-note",
      "owner-1",
      3,
      "pending",
    );

    const { SQLiteSyncStore } = await import("./sync");
    const store = new SQLiteSyncStore(database);
    const purge = permanentDeletion("document", "note-1", 3, ["drawing-1"]);

    await expect(store.applyRemote(purge)).resolves.toBe("applied");
    expect(deletedFiles).toHaveLength(4);
    expect(await database.getFirstAsync("SELECT id FROM documents WHERE id = ?", "note-1")).toBe(
      null,
    );
    expect(await database.getFirstAsync("SELECT id FROM drawings WHERE id = ?", "drawing-1")).toBe(
      null,
    );
    expect(
      await database.getFirstAsync(
        "SELECT id FROM outbox WHERE owner_id = ? AND entity_id = ?",
        "owner-1",
        "note-1",
      ),
    ).toBe(null);
    expect(
      await database.getFirstAsync(
        "SELECT revision FROM sync_tombstones WHERE owner_id = ? AND entity_type = ? AND entity_id = ?",
        "owner-1",
        "document",
        "note-1",
      ),
    ).toMatchObject({ revision: 3 });

    await expect(store.applyRemote(purge)).resolves.toBe("ignored");
    expect(deletedFiles).toHaveLength(4);

    const resurrection: RemoteChange = {
      ...purge,
      eventId: "late-upsert",
      operation: "upsert",
      revision: 4,
      idempotencyKey: "late-upsert",
      payload: {
        id: "note-1",
        ownerId: "owner-1",
        kind: "note",
        title: "Resurrected",
        markdown: "# Resurrected",
        path: null,
        projectId: null,
        isPinned: false,
        revision: 4,
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
        deletedAt: null,
        updatedByDeviceId: "stale-device",
      },
    };
    await expect(store.applyRemote(resurrection)).resolves.toBe("ignored");
    expect(await database.getFirstAsync("SELECT id FROM documents WHERE id = ?", "note-1")).toBe(
      null,
    );
  });

  it("turns the local permanent-delete action into durable purge events", async () => {
    const raw = new DatabaseSync(":memory:");
    databases.push(raw);
    applyMigrations(raw);
    const database = asStoneDatabase(raw);
    await database.runAsync(
      "INSERT INTO documents (id, owner_id, kind, title, markdown, is_pinned, revision, created_at, updated_at, deleted_at, updated_by_device_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      "note-1",
      "owner-1",
      "note",
      "Trash me",
      "# Trash me",
      0,
      2,
      "2026-08-01T00:00:00.000Z",
      "2026-08-02T00:00:00.000Z",
      "2026-08-02T00:00:00.000Z",
      "device-1",
    );
    await database.runAsync(
      "INSERT INTO documents (id, owner_id, kind, title, markdown, is_pinned, revision, created_at, updated_at, updated_by_device_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      "note-2",
      "owner-1",
      "note",
      "Keep me",
      "# Keep me",
      0,
      1,
      "2026-08-01T00:00:00.000Z",
      "2026-08-01T00:00:00.000Z",
      "device-1",
    );
    await database.runAsync(
      "INSERT INTO drawings (id, owner_id, document_id, title, source_path, preview_path, source_sha256, preview_sha256, source_size, preview_size, revision, created_at, updated_at, updated_by_device_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      "drawing-1",
      "owner-1",
      "note-1",
      "Sketch",
      "file:///source-current.stoneink",
      "file:///preview-current.png",
      "source",
      "preview",
      1,
      1,
      3,
      "2026-08-01T00:00:00.000Z",
      "2026-08-02T00:00:00.000Z",
      "device-1",
    );
    await database.runAsync(
      "INSERT INTO drawing_revisions (id, drawing_id, revision, source_path, preview_path, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      "drawing-1:2",
      "drawing-1",
      2,
      "file:///source-old.stoneink",
      "file:///preview-old.png",
      "2026-08-01T00:00:00.000Z",
    );
    await database.runAsync(
      "INSERT INTO outbox (id, entity_type, entity_id, operation, base_revision, payload_version, payload, created_at, idempotency_key, owner_id, revision, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      "old-note-event",
      "document",
      "note-1",
      "upsert",
      1,
      1,
      JSON.stringify({ id: "note-1" }),
      "2026-08-01T00:00:00.000Z",
      "old-note-event",
      "owner-1",
      2,
      "pending",
    );

    const { SQLiteNoteRepository } = await import("./notes");
    await new SQLiteNoteRepository(database).permanentlyDelete("owner-1", "note-1", "device-1");

    expect(await database.getFirstAsync("SELECT id FROM documents WHERE id = ?", "note-1")).toBe(
      null,
    );
    expect(
      await database.getFirstAsync("SELECT id FROM documents WHERE id = ?", "note-2"),
    ).toMatchObject({ id: "note-2" });
    expect(await database.getFirstAsync("SELECT id FROM drawings WHERE id = ?", "drawing-1")).toBe(
      null,
    );
    expect(deletedFiles).toEqual([
      "file:///source-current.stoneink",
      "file:///preview-current.png",
      "file:///source-old.stoneink",
      "file:///preview-old.png",
    ]);
    expect(
      await database.getFirstAsync(
        "SELECT revision FROM sync_tombstones WHERE owner_id = ? AND entity_type = ? AND entity_id = ?",
        "owner-1",
        "document",
        "note-1",
      ),
    ).toMatchObject({ revision: 3 });
    expect(
      await database.getFirstAsync(
        "SELECT revision FROM sync_tombstones WHERE owner_id = ? AND entity_type = ? AND entity_id = ?",
        "owner-1",
        "drawing",
        "drawing-1",
      ),
    ).toMatchObject({ revision: 4 });
    const events = await database.getAllAsync<{ entity_type: string; payload: string }>(
      "SELECT entity_type, payload FROM outbox WHERE owner_id = ? ORDER BY entity_type",
      "owner-1",
    );
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.entity_type)).toEqual(["document", "drawing"]);
    const documentPayload = JSON.parse(events[0]?.payload ?? "{}") as Record<string, unknown>;
    expect(documentPayload).toMatchObject({ purge: true });
    expect(documentPayload.cascadeDrawingIds).toEqual(["drawing-1"]);
  });
});

function permanentDeletion(
  entityType: RemoteChange["entityType"],
  entityId: string,
  revision: number,
  cascadeDrawingIds: readonly string[] = [],
): RemoteChange {
  return {
    eventId: "purge-event",
    ownerId: "owner-1",
    entityType,
    entityId,
    operation: "delete",
    revision,
    payloadVersion: 1,
    payload: {
      id: entityId,
      ownerId: "owner-1",
      revision,
      deletedAt: "2026-08-02T00:00:00.000Z",
      updatedAt: "2026-08-02T00:00:00.000Z",
      updatedByDeviceId: "remote-device",
      purge: true,
      cascadeDrawingIds,
    },
    createdAt: "2026-08-02T00:00:00.000Z",
    idempotencyKey: "purge-event",
  };
}

function applyMigrations(database: DatabaseSync): void {
  for (const migration of migrations) {
    database.exec("BEGIN");
    try {
      for (const statement of migration.statements) database.exec(statement);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
}

function asStoneDatabase(database: DatabaseSync): StoneDatabase {
  return {
    runAsync: (sql: string, ...args: (string | number | null)[]) =>
      Promise.resolve(database.prepare(sql).run(...args)),
    getFirstAsync: <T>(sql: string, ...args: (string | number | null)[]) =>
      Promise.resolve((database.prepare(sql).get(...args) as T | undefined) ?? null),
    getAllAsync: <T>(sql: string, ...args: (string | number | null)[]) =>
      Promise.resolve(database.prepare(sql).all(...args) as T[]),
    withTransactionAsync: async (operation: () => Promise<void>) => {
      database.exec("BEGIN");
      try {
        await operation();
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  } as unknown as StoneDatabase;
}
