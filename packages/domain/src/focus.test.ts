import { describe, expect, it } from "vitest";
import type { FocusClock, FocusSession } from "./index.js";
import {
  adjustFocusSession,
  aggregateFocusSessions,
  cancelFocusSession,
  createManualFocusSession,
  elapsedFocusSeconds,
  finishFocusSession,
  focusGoalProgress,
  isFocusExpired,
  nextPomodoroPhase,
  pauseFocusSession,
  remainingFocusSeconds,
  resumeFocusSession,
  startFocusSession,
  validateFocusSession,
} from "./index.js";

const clock = (value: string): FocusClock => ({ now: () => value });
const start = (mode: "stopwatch" | "countdown" | "pomodoro" = "stopwatch"): FocusSession =>
  startFocusSession(
    {
      id: "focus-1",
      ownerId: "owner-1",
      deviceId: "device-1",
      mode,
      plannedDurationSeconds: mode === "stopwatch" ? null : 1_500,
    },
    clock("2026-07-29T09:00:00.000Z"),
  );

describe("durable focus timer", () => {
  it("derives stopwatch time from persisted timestamps and excludes pauses", () => {
    const paused = pauseFocusSession(start(), clock("2026-07-29T09:10:00.000Z"));
    expect(elapsedFocusSeconds(paused, "2026-07-29T10:00:00.000Z")).toBe(600);
    const resumed = resumeFocusSession(paused, clock("2026-07-29T09:15:00.000Z"));
    const completed = finishFocusSession(resumed, clock("2026-07-29T09:30:00.000Z"));
    expect(completed.actualFocusSeconds).toBe(1_500);
    expect(completed.accumulatedPausedSeconds).toBe(300);
    expect(completed.status).toBe("completed");
  });

  it("recovers countdown state and prevents negative remaining time", () => {
    const session = start("countdown");
    expect(remainingFocusSeconds(session, "2026-07-29T09:10:00.000Z")).toBe(900);
    expect(remainingFocusSeconds(session, "2026-07-29T10:00:00.000Z")).toBe(0);
    expect(isFocusExpired(session, "2026-07-29T10:00:00.000Z")).toBe(true);
    expect(elapsedFocusSeconds(session, "2026-07-29T08:00:00.000Z")).toBe(0);
  });

  it("rejects duplicate transitions and retains cancelled history", () => {
    const completed = finishFocusSession(start(), clock("2026-07-29T09:01:00.000Z"));
    expect(() => finishFocusSession(completed, clock("2026-07-29T09:02:00.000Z"))).toThrow();
    const cancelled = cancelFocusSession(start(), clock("2026-07-29T09:00:30.000Z"));
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.actualFocusSeconds).toBe(30);
  });

  it("uses a deterministic four-cycle Pomodoro sequence", () => {
    expect(nextPomodoroPhase("focus", 0)).toEqual({ phase: "short_break", cycle: 1 });
    expect(nextPomodoroPhase("short_break", 1)).toEqual({ phase: "focus", cycle: 1 });
    expect(nextPomodoroPhase("focus", 3)).toEqual({ phase: "long_break", cycle: 4 });
  });

  it("supports bounded manual entries and corrections", () => {
    const manual = createManualFocusSession(
      {
        id: "manual-1",
        ownerId: "owner-1",
        deviceId: "device-1",
        mode: "stopwatch",
        startedAt: "2026-07-29T08:00:00.000Z",
        endedAt: "2026-07-29T08:45:00.000Z",
        note: "Reading",
      },
      clock("2026-07-29T10:00:00.000Z"),
    );
    expect(manual.manuallyAdjustedSeconds).toBe(2_700);
    expect(
      adjustFocusSession(manual, 2_400, "Corrected", clock("2026-07-29T11:00:00.000Z"))
        .actualFocusSeconds,
    ).toBe(2_400);
  });

  it("validates malformed sessions", () => {
    expect(() => validateFocusSession({ ...start(), status: "paused", pauses: [] })).toThrow();
    expect(() =>
      validateFocusSession({ ...start("countdown"), plannedDurationSeconds: -1 }),
    ).toThrow();
  });
});

describe("focus analytics and goals", () => {
  const completed = (
    id: string,
    startAt: string,
    endAt: string,
    options: Partial<FocusSession> = {},
  ): FocusSession => {
    const session = startFocusSession(
      {
        id,
        ownerId: "owner-1",
        deviceId: "device-1",
        mode: "countdown",
        plannedDurationSeconds: 1_500,
        taskId: "task-1",
        projectId: "project-1",
        category: "study",
      },
      clock(startAt),
    );
    return { ...finishFocusSession(session, clock(endAt)), ...options };
  };

  it("excludes breaks, unresolved conflicts, and overlapping records from focus totals", () => {
    const first = completed("one", "2026-07-28T09:00:00.000Z", "2026-07-28T09:25:00.000Z");
    const overlap = completed("two", "2026-07-28T09:20:00.000Z", "2026-07-28T09:40:00.000Z");
    const breakSession = completed(
      "break",
      "2026-07-28T10:00:00.000Z",
      "2026-07-28T10:05:00.000Z",
      {
        phase: "short_break",
      },
    );
    const conflict = completed("conflict", "2026-07-28T11:00:00.000Z", "2026-07-28T11:10:00.000Z", {
      conflictState: "overlap_unresolved",
    });
    const summary = aggregateFocusSessions(
      [first, overlap, breakSession, conflict],
      "Europe/Istanbul",
    );
    expect(summary.focusedSeconds).toBe(1_500);
    expect(summary.breakSeconds).toBe(300);
    expect(summary.excludedOverlappingSessions).toBe(1);
    expect(summary.excludedConflictedSessions).toBe(1);
    expect(summary.byTask["task-1"]).toBe(1_500);
  });

  it("calculates offline daily and Monday-based weekly goal progress prospectively", () => {
    const session = completed("goal", "2026-07-29T09:00:00.000Z", "2026-07-29T09:30:00.000Z");
    const earlier = completed("earlier", "2026-07-28T09:00:00.000Z", "2026-07-28T09:30:00.000Z");
    const progress = focusGoalProgress(
      [earlier, session],
      {
        id: "goal-1",
        ownerId: "owner-1",
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
      },
      "2026-07-29",
    );
    expect(progress.dailySeconds).toBe(1_800);
    expect(progress.weeklySeconds).toBe(1_800);
    expect(progress.dailyTargetSeconds).toBe(3_600);
  });

  it("aggregates thousands of sessions deterministically", () => {
    const sessions = Array.from({ length: 5_000 }, (_, index) => {
      const startedAt = new Date(Date.UTC(2026, 0, 1, index, 0, 0)).toISOString();
      const endedAt = new Date(Date.UTC(2026, 0, 1, index, 1, 0)).toISOString();
      return completed(`bulk-${index}`, startedAt, endedAt);
    });
    const first = aggregateFocusSessions(sessions, "UTC");
    const reversed = aggregateFocusSessions([...sessions].reverse(), "UTC");
    expect(first.focusedSeconds).toBe(300_000);
    expect(reversed).toEqual(first);
  });
});
