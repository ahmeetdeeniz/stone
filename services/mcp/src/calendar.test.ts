import { describe, expect, it } from "vitest";
import { StoneMcpService } from "./core.js";
import { MemoryStoneStore } from "./store.js";
import type { AuthContext } from "./contracts.js";

const context: AuthContext = {
  userId: "owner-1",
  clientId: "client-1",
  scopes: ["stone.read.calendar", "stone.write.calendar"],
};

describe("calendar MCP", () => {
  it("keeps scheduling separate from task due semantics and protects revisions", async () => {
    const store = new MemoryStoneStore();
    const service = new StoneMcpService(store, {
      now: () => new Date("2026-01-15T10:00:00.000Z"),
      idFactory: () => "block-1",
    });
    const created = await service.createCalendarEvent(context, {
      title: "Write release notes",
      kind: "task_block",
      taskId: "task-1",
      startDate: "2026-01-16",
      endDate: "2026-01-16",
      startAt: "2026-01-16T09:00:00.000Z",
      endAt: "2026-01-16T10:00:00.000Z",
      timezone: "Europe/Istanbul",
      expectedRevision: 0,
      idempotencyKey: "calendar-create-1",
    });
    expect(created.entity).toMatchObject({ kind: "task_block", taskId: "task-1", revision: 1 });
    const replay = await service.createCalendarEvent(context, {
      title: "Write release notes",
      kind: "task_block",
      taskId: "task-1",
      startDate: "2026-01-16",
      endDate: "2026-01-16",
      startAt: "2026-01-16T09:00:00.000Z",
      endAt: "2026-01-16T10:00:00.000Z",
      timezone: "Europe/Istanbul",
      expectedRevision: 0,
      idempotencyKey: "calendar-create-1",
    });
    expect(replay.replayed).toBe(true);
    await expect(
      service.updateCalendarEvent(context, "block-1", {
        startAt: "2026-01-16T11:00:00.000Z",
        endAt: "2026-01-16T12:00:00.000Z",
        expectedRevision: 0,
        idempotencyKey: "calendar-update-1",
      }),
    ).rejects.toMatchObject({ code: "revision_conflict" });
  });

  it("bounds date windows and scopes reads by owner", async () => {
    const service = new StoneMcpService(new MemoryStoneStore());
    await expect(
      service.listCalendarEvents(context, { startDate: "2026-01-01", endDate: "2028-01-01" }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(
      await service.listCalendarEvents(context, {
        startDate: "2026-01-01",
        endDate: "2026-01-31",
      }),
    ).toMatchObject({ items: [] });
  });
});
