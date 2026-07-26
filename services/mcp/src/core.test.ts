import { describe, expect, it } from "vitest";
import {
  McpForbiddenError,
  McpRevisionConflictError,
  type AuthContext,
  type DocumentRecord,
} from "./contracts.js";
import { StoneMcpService } from "./core.js";
import { MemoryStoneStore } from "./store.js";

const ownerA: AuthContext = {
  userId: "owner-a",
  clientId: "test-client",
  scopes: [
    "stone.read.notes",
    "stone.read.projects",
    "stone.read.tasks",
    "stone.write.notes",
    "stone.write.projects",
    "stone.write.tasks",
  ],
};
const ownerB: AuthContext = { ...ownerA, userId: "owner-b" };

function note(ownerId: string, id = "note-1", revision = 1): DocumentRecord {
  return {
    id,
    ownerId,
    kind: "note",
    title: "A note",
    markdown: "# A note\n",
    path: null,
    projectId: null,
    isPinned: false,
    revision,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    updatedByDeviceId: "device",
  };
}

describe("Stone MCP core", () => {
  it("keeps reads owner-scoped and rejects missing scopes", async () => {
    const store = new MemoryStoneStore();
    store.seedDocument(note("owner-a"));
    const service = new StoneMcpService(store);
    await expect(service.getNote(ownerB, "note-1")).rejects.toThrow("Document not found");
    await expect(
      service.getNote({ ...ownerA, scopes: ["stone.read.projects"] }, "note-1"),
    ).rejects.toBeInstanceOf(McpForbiddenError);
  });

  it("rejects invalid write controls before touching the store", async () => {
    const service = new StoneMcpService(new MemoryStoneStore());
    await expect(
      service.createNote(ownerA, {
        title: "Invalid",
        expectedRevision: -1,
        idempotencyKey: "bad key",
      }),
    ).rejects.toThrow("expectedRevision");
  });

  it("enforces revisions and replays duplicate writes", async () => {
    const store = new MemoryStoneStore();
    const service = new StoneMcpService(store, { idFactory: () => "created-note" });
    const first = await service.createNote(ownerA, {
      title: "Created",
      markdown: "Body",
      expectedRevision: 0,
      idempotencyKey: "create-note-1",
    });
    const replay = await service.createNote(ownerA, {
      title: "Created",
      markdown: "Body",
      expectedRevision: 0,
      idempotencyKey: "create-note-1",
    });
    expect(first.entity.id).toBe("created-note");
    expect(replay.replayed).toBe(true);
    expect(store.audits).toHaveLength(1);
    await expect(
      service.appendToNote(ownerA, "created-note", {
        text: "changed",
        expectedRevision: 0,
        idempotencyKey: "append-note-1",
      }),
    ).rejects.toBeInstanceOf(McpRevisionConflictError);
    const updated = await service.appendToNote(ownerA, "created-note", {
      text: "changed",
      expectedRevision: 1,
      idempotencyKey: "append-note-1",
    });
    expect(updated.entity.markdown).toContain("changed");
    expect(updated.afterRevision).toBe(2);
  });

  it("creates and completes a task through the Markdown boundary", async () => {
    const store = new MemoryStoneStore();
    store.seedDocument(note("owner-a"));
    const service = new StoneMcpService(store);
    const created = await service.createTask(ownerA, "note-1", {
      text: "Ship MCP",
      due: "2026-07-26",
      expectedRevision: 1,
      idempotencyKey: "task-create-1",
    });
    expect(created.taskId).toMatch(/^tsk_/u);
    const completed = await service.completeTask(ownerA, "note-1", created.taskId, {
      completed: true,
      expectedRevision: 2,
      idempotencyKey: "task-complete-1",
    });
    expect(completed.entity.markdown).toContain("[x]");
  });
});
