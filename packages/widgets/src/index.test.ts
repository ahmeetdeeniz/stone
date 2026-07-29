import { describe, expect, it } from "vitest";
import {
  WIDGET_ACTION_VERSION,
  WIDGET_SNAPSHOT_VERSION,
  enqueueWidgetAction,
  parseStoneDeepLink,
  parseWidgetActionQueue,
  parseWidgetSnapshot,
  pendingWidgetActions,
  redactWidgetSnapshot,
  safeWidgetSnapshot,
  type WidgetAction,
  type WidgetSnapshot,
} from "./index.js";

const now = "2026-07-29T12:00:00.000Z";

function snapshot(): WidgetSnapshot {
  return {
    schemaVersion: WIDGET_SNAPSHOT_VERSION,
    generatedAt: now,
    lastSuccessfulRefreshAt: now,
    staleAfter: "2026-07-29T12:30:00.000Z",
    locale: "en",
    timezone: "Europe/Istanbul",
    privacy: "titles_and_context",
    authenticated: true,
    todayRemainingCount: 1,
    todayTasks: [
      {
        id: "task-1",
        title: "Private task",
        completed: false,
        revision: 2,
        dueLabel: "Today",
        priority: "high",
        projectName: "Stone",
      },
    ],
    agenda: [
      {
        id: "event-1",
        kind: "event",
        title: "Private event",
        startAt: "2026-07-29T13:00:00.000Z",
        endAt: "2026-07-29T14:00:00.000Z",
        allDay: false,
        projectName: "Stone",
      },
    ],
    focus: {
      sessionId: "focus-1",
      mode: "countdown",
      phase: "focus",
      status: "running",
      startedAt: now,
      plannedDurationSeconds: 1500,
      accumulatedPausedSeconds: 0,
      pausedAt: null,
      contextTitle: "Private task",
      revision: 1,
    },
    dailyGoalSeconds: 3600,
    dailyFocusedSeconds: 1200,
    quickActionsEnabled: true,
  };
}

function action(overrides: Partial<WidgetAction> = {}): WidgetAction {
  return {
    schemaVersion: WIDGET_ACTION_VERSION,
    id: "action-1",
    type: "complete_task",
    targetId: "task-1",
    createdAt: now,
    expectedRevision: 2,
    idempotencyKey: "widget-action-1",
    status: "pending",
    ...overrides,
  };
}

describe("widget snapshot", () => {
  it("validates bounded safe snapshots and rejects secrets/corruption", () => {
    expect(parseWidgetSnapshot(snapshot())).toEqual(snapshot());
    expect(() => parseWidgetSnapshot({ ...snapshot(), schemaVersion: 99 })).toThrow(
      "schema version",
    );
    expect(() => parseWidgetSnapshot({ ...snapshot(), firebaseToken: "secret" })).toThrow(
      "credentials",
    );
    expect(safeWidgetSnapshot({ broken: true }, "2026-07-29T13:00:00.000Z")).toEqual({
      snapshot: null,
      stale: true,
    });
  });

  it("redacts titles and contexts without changing stable identifiers", () => {
    const redacted = redactWidgetSnapshot(snapshot(), "counts_only");
    expect(redacted.todayTasks[0]).toMatchObject({ id: "task-1", title: "", projectName: null });
    expect(redacted.agenda[0]).toMatchObject({ id: "event-1", title: "", projectName: null });
    expect(redacted.focus?.contextTitle).toBeNull();
  });

  it("marks materially old snapshots stale", () => {
    expect(safeWidgetSnapshot(snapshot(), "2026-07-29T12:29:00.000Z").stale).toBe(false);
    expect(safeWidgetSnapshot(snapshot(), "2026-07-29T12:31:00.000Z").stale).toBe(true);
  });
});

describe("native action queue", () => {
  it("deduplicates idempotency keys, bounds actions and expires stale requests", () => {
    const first = enqueueWidgetAction(
      { schemaVersion: WIDGET_ACTION_VERSION, actions: [] },
      action(),
      now,
    );
    expect(enqueueWidgetAction(first, action({ id: "action-2" }), now)).toEqual(first);
    expect(pendingWidgetActions(first, "2026-07-30T11:59:00.000Z")).toHaveLength(1);
    expect(pendingWidgetActions(first, "2026-07-30T12:01:00.000Z")).toHaveLength(0);
  });

  it("rejects duplicate persisted actions and unknown action types", () => {
    expect(() =>
      parseWidgetActionQueue({
        schemaVersion: 1,
        actions: [action(), action()],
      }),
    ).toThrow("unique");
    expect(() =>
      parseWidgetActionQueue({ schemaVersion: 1, actions: [{ ...action(), type: "x" }] }),
    ).toThrow();
  });
});

describe("Stone deep links", () => {
  it("accepts stable bounded routes", () => {
    expect(parseStoneDeepLink("stone://today")).toEqual({ route: "today" });
    expect(parseStoneDeepLink("stone://task/task-1")).toEqual({ route: "task", id: "task-1" });
    expect(parseStoneDeepLink("stone://calendar/2026-07-29")).toEqual({
      route: "calendar_date",
      date: "2026-07-29",
    });
  });

  it("rejects arbitrary paths, queries, credentials and malformed identifiers", () => {
    expect(parseStoneDeepLink("https://example.com/task/1")).toBeNull();
    expect(parseStoneDeepLink("stone://task/../../secret")).toBeNull();
    expect(parseStoneDeepLink("stone://task/id?redirect=https://example.com")).toBeNull();
    expect(parseStoneDeepLink("stone://user:password@task/id")).toBeNull();
  });
});
