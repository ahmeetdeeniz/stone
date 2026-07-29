import type { FocusGoal, FocusPhase, FocusSession, FocusStatus } from "./entities.js";
import { ValidationError } from "./errors.js";
import { isValidIsoDate } from "./project-logic.js";
import { isValidTimeZone } from "./task-logic.js";

export interface FocusClock {
  now(): string;
}

export interface StartFocusInput {
  id: string;
  ownerId: string;
  deviceId: string;
  mode: FocusSession["mode"];
  phase?: FocusPhase;
  plannedDurationSeconds?: number | null;
  taskId?: string | null;
  projectId?: string | null;
  sourceDocumentId?: string | null;
  calendarItemId?: string | null;
  category?: string | null;
  tags?: readonly string[];
  note?: string | null;
  pomodoroGroupId?: string | null;
  pomodoroCycle?: number | null;
}

export interface FocusSummary {
  focusedSeconds: number;
  breakSeconds: number;
  plannedSeconds: number;
  completedSessions: number;
  manualSessions: number;
  excludedConflictedSessions: number;
  excludedOverlappingSessions: number;
  averageSessionSeconds: number;
  byDay: Readonly<Record<string, number>>;
  byTask: Readonly<Record<string, number>>;
  byProject: Readonly<Record<string, number>>;
  byCategory: Readonly<Record<string, number>>;
  byHour: Readonly<Record<string, number>>;
}

export function startFocusSession(input: StartFocusInput, clock: FocusClock): FocusSession {
  const now = clock.now();
  const phase = input.phase ?? "focus";
  const planned =
    input.mode === "stopwatch" ? null : requireDuration(input.plannedDurationSeconds ?? null);
  const session: FocusSession = {
    id: required(input.id, "Focus session ID"),
    ownerId: required(input.ownerId, "Focus owner"),
    schemaVersion: 1,
    mode: input.mode,
    status: "running",
    phase,
    startedAt: now,
    endedAt: null,
    plannedDurationSeconds: planned,
    actualFocusSeconds: 0,
    accumulatedPausedSeconds: 0,
    pauses: [],
    manuallyAdjustedSeconds: null,
    taskId: input.taskId ?? null,
    projectId: input.projectId ?? null,
    sourceDocumentId: input.sourceDocumentId ?? null,
    calendarItemId: input.calendarItemId ?? null,
    category: optionalText(input.category, 120),
    tags: [...(input.tags ?? [])],
    note: optionalText(input.note, 8_000),
    pomodoroGroupId: input.pomodoroGroupId ?? null,
    pomodoroCycle: input.pomodoroCycle ?? null,
    activeDeviceId: required(input.deviceId, "Active device"),
    conflictState: "none",
    revision: 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    updatedByDeviceId: input.deviceId,
  };
  return validateFocusSession(session);
}

export function pauseFocusSession(session: FocusSession, clock: FocusClock): FocusSession {
  requireStatus(session, "running");
  const now = boundedNow(session, clock.now());
  return validateFocusSession({
    ...session,
    status: "paused",
    pauses: [...session.pauses, { startedAt: now, endedAt: null }],
    updatedAt: now,
    revision: session.revision + 1,
  });
}

export function resumeFocusSession(session: FocusSession, clock: FocusClock): FocusSession {
  requireStatus(session, "paused");
  const now = boundedNow(session, clock.now());
  const pause = session.pauses.at(-1);
  if (!pause || pause.endedAt) throw new ValidationError("Focus pause state is incomplete.");
  const pauseSeconds = secondsBetween(pause.startedAt, now);
  return validateFocusSession({
    ...session,
    status: "running",
    accumulatedPausedSeconds: session.accumulatedPausedSeconds + pauseSeconds,
    pauses: [...session.pauses.slice(0, -1), { ...pause, endedAt: now }],
    updatedAt: now,
    revision: session.revision + 1,
  });
}

export function finishFocusSession(session: FocusSession, clock: FocusClock): FocusSession {
  if (session.status !== "running" && session.status !== "paused")
    throw new ValidationError("Only an active focus session can be completed.");
  const now = boundedNow(session, clock.now());
  const normalized = closeOpenPause(session, now);
  return validateFocusSession({
    ...normalized,
    status: "completed",
    endedAt: now,
    actualFocusSeconds: elapsedFocusSeconds(normalized, now),
    updatedAt: now,
    revision: session.revision + 1,
  });
}

export function cancelFocusSession(session: FocusSession, clock: FocusClock): FocusSession {
  if (session.status !== "running" && session.status !== "paused")
    throw new ValidationError("Only an active focus session can be cancelled.");
  const now = boundedNow(session, clock.now());
  const normalized = closeOpenPause(session, now);
  return validateFocusSession({
    ...normalized,
    status: "cancelled",
    endedAt: now,
    actualFocusSeconds: elapsedFocusSeconds(normalized, now),
    updatedAt: now,
    revision: session.revision + 1,
  });
}

export function elapsedFocusSeconds(session: FocusSession, now: string): number {
  if (session.manuallyAdjustedSeconds !== null) return session.manuallyAdjustedSeconds;
  if (session.status === "completed" || session.status === "cancelled")
    return Math.max(0, session.actualFocusSeconds);
  const effectiveNow =
    session.status === "paused"
      ? (session.pauses.at(-1)?.startedAt ?? now)
      : boundedNow(session, now);
  return Math.max(
    0,
    secondsBetween(session.startedAt, effectiveNow) - session.accumulatedPausedSeconds,
  );
}

export function remainingFocusSeconds(session: FocusSession, now: string): number | null {
  if (session.plannedDurationSeconds === null) return null;
  return Math.max(0, session.plannedDurationSeconds - elapsedFocusSeconds(session, now));
}

export function isFocusExpired(session: FocusSession, now: string): boolean {
  const remaining = remainingFocusSeconds(session, now);
  return session.status === "running" && remaining !== null && remaining === 0;
}

export function nextPomodoroPhase(
  phase: FocusPhase,
  completedFocusCycles: number,
): { phase: FocusPhase; cycle: number } {
  if (phase !== "focus") return { phase: "focus", cycle: completedFocusCycles };
  const nextCycle = completedFocusCycles + 1;
  return {
    phase: nextCycle % 4 === 0 ? "long_break" : "short_break",
    cycle: nextCycle,
  };
}

export function adjustFocusSession(
  session: FocusSession,
  seconds: number,
  note: string | null,
  clock: FocusClock,
): FocusSession {
  if (session.status !== "completed")
    throw new ValidationError("Only completed time can be edited.");
  requireDuration(seconds);
  const now = clock.now();
  return validateFocusSession({
    ...session,
    manuallyAdjustedSeconds: seconds,
    actualFocusSeconds: seconds,
    note: optionalText(note, 8_000),
    updatedAt: now,
    revision: session.revision + 1,
  });
}

export function createManualFocusSession(
  input: StartFocusInput & { startedAt: string; endedAt: string },
  clock: FocusClock,
): FocusSession {
  const duration = secondsBetween(input.startedAt, input.endedAt);
  requireDuration(duration);
  const base = startFocusSession(input, { now: () => input.startedAt });
  return validateFocusSession({
    ...base,
    status: "completed",
    endedAt: input.endedAt,
    actualFocusSeconds: duration,
    manuallyAdjustedSeconds: duration,
    updatedAt: clock.now(),
  });
}

export function validateFocusSession(session: FocusSession): FocusSession {
  if (session.schemaVersion !== 1) throw new ValidationError("Unsupported focus schema version.");
  required(session.id, "Focus session ID");
  required(session.ownerId, "Focus owner");
  required(session.activeDeviceId, "Active device");
  instant(session.startedAt, "Focus start");
  if (session.endedAt) instant(session.endedAt, "Focus end");
  if (session.endedAt && Date.parse(session.endedAt) < Date.parse(session.startedAt))
    throw new ValidationError("Focus end precedes start.");
  if (!["stopwatch", "countdown", "pomodoro"].includes(session.mode))
    throw new ValidationError("Focus mode is invalid.");
  if (!["running", "paused", "completed", "cancelled"].includes(session.status))
    throw new ValidationError("Focus status is invalid.");
  if (!["focus", "short_break", "long_break"].includes(session.phase))
    throw new ValidationError("Focus phase is invalid.");
  if (session.mode === "stopwatch" && session.plannedDurationSeconds !== null)
    throw new ValidationError("Stopwatch sessions do not use a planned duration.");
  if (session.mode !== "stopwatch") requireDuration(session.plannedDurationSeconds);
  if (session.actualFocusSeconds < 0 || session.accumulatedPausedSeconds < 0)
    throw new ValidationError("Focus durations cannot be negative.");
  if (session.tags.length > 50 || session.tags.some((tag) => !tag.trim() || tag.length > 120))
    throw new ValidationError("Focus tags are invalid.");
  optionalText(session.category, 120);
  optionalText(session.note, 8_000);
  const openPauses = session.pauses.filter((pause) => pause.endedAt === null);
  if (openPauses.length > 1 || (session.status === "paused") !== (openPauses.length === 1))
    throw new ValidationError("Focus pause intervals do not match the session state.");
  for (const pause of session.pauses) {
    instant(pause.startedAt, "Pause start");
    if (pause.endedAt) {
      instant(pause.endedAt, "Pause end");
      if (Date.parse(pause.endedAt) < Date.parse(pause.startedAt))
        throw new ValidationError("Pause end precedes start.");
    }
  }
  return {
    ...session,
    tags: [...session.tags],
    pauses: session.pauses.map((pause) => ({ ...pause })),
  };
}

export function validateFocusGoal(goal: FocusGoal): FocusGoal {
  if (goal.schemaVersion !== 1) throw new ValidationError("Unsupported focus goal schema.");
  if (!isValidTimeZone(goal.timezone)) throw new ValidationError("Focus goal timezone is invalid.");
  if (!isValidIsoDate(goal.effectiveFromDate))
    throw new ValidationError("Focus goal effective date is invalid.");
  if (!Number.isInteger(goal.dailyMinutes) || goal.dailyMinutes < 0 || goal.dailyMinutes > 1_440)
    throw new ValidationError("Daily focus goal is invalid.");
  if (
    !Number.isInteger(goal.weeklyMinutes) ||
    goal.weeklyMinutes < 0 ||
    goal.weeklyMinutes > 10_080
  )
    throw new ValidationError("Weekly focus goal is invalid.");
  return { ...goal };
}

export function aggregateFocusSessions(
  sessions: readonly FocusSession[],
  timezone: string,
): FocusSummary {
  if (!isValidTimeZone(timezone)) throw new ValidationError("Analytics timezone is invalid.");
  const included: FocusSession[] = [];
  let excludedConflictedSessions = 0;
  let excludedOverlappingSessions = 0;
  for (const session of [...sessions].sort((a, b) => a.startedAt.localeCompare(b.startedAt))) {
    if (
      session.status !== "completed" ||
      session.deletedAt ||
      session.conflictState === "overlap_unresolved" ||
      session.conflictState === "resolved_exclude"
    ) {
      if (session.conflictState === "overlap_unresolved") excludedConflictedSessions += 1;
      continue;
    }
    if (
      session.endedAt &&
      included.some(
        (candidate) =>
          candidate.endedAt &&
          candidate.startedAt < session.endedAt! &&
          candidate.endedAt > session.startedAt,
      )
    ) {
      excludedOverlappingSessions += 1;
      continue;
    }
    included.push(session);
  }
  const byDay: Record<string, number> = {};
  const byTask: Record<string, number> = {};
  const byProject: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  const byHour: Record<string, number> = {};
  let focusedSeconds = 0;
  let breakSeconds = 0;
  let plannedSeconds = 0;
  let manualSessions = 0;
  for (const session of included) {
    const seconds = session.manuallyAdjustedSeconds ?? session.actualFocusSeconds;
    if (session.phase === "focus") focusedSeconds += seconds;
    else breakSeconds += seconds;
    plannedSeconds += session.plannedDurationSeconds ?? 0;
    if (session.manuallyAdjustedSeconds !== null) manualSessions += 1;
    const date = localPart(session.startedAt, timezone, "date");
    const hour = localPart(session.startedAt, timezone, "hour");
    if (session.phase === "focus") {
      add(byDay, date, seconds);
      add(byHour, hour, seconds);
      if (session.taskId) add(byTask, session.taskId, seconds);
      if (session.projectId) add(byProject, session.projectId, seconds);
      if (session.category) add(byCategory, session.category, seconds);
    }
  }
  const focusSessions = included.filter((session) => session.phase === "focus");
  return {
    focusedSeconds,
    breakSeconds,
    plannedSeconds,
    completedSessions: focusSessions.length,
    manualSessions,
    excludedConflictedSessions,
    excludedOverlappingSessions,
    averageSessionSeconds:
      focusSessions.length === 0 ? 0 : Math.round(focusedSeconds / focusSessions.length),
    byDay,
    byTask,
    byProject,
    byCategory,
    byHour,
  };
}

export function focusGoalProgress(
  sessions: readonly FocusSession[],
  goal: FocusGoal,
  date: string,
): {
  dailySeconds: number;
  weeklySeconds: number;
  dailyTargetSeconds: number;
  weeklyTargetSeconds: number;
} {
  validateFocusGoal(goal);
  if (!isValidIsoDate(date)) throw new ValidationError("Goal progress date is invalid.");
  const summary = aggregateFocusSessions(sessions, goal.timezone);
  const day = new Date(`${date}T12:00:00Z`);
  const weekday = day.getUTCDay() || 7;
  const monday = new Date(day);
  monday.setUTCDate(day.getUTCDate() - weekday + 1);
  const mondayDate = monday.toISOString().slice(0, 10);
  const weeklySeconds = Object.entries(summary.byDay)
    .filter(([entry]) => entry >= mondayDate && entry <= date)
    .reduce((total, [, seconds]) => total + seconds, 0);
  return {
    dailySeconds: summary.byDay[date] ?? 0,
    weeklySeconds,
    dailyTargetSeconds: goal.dailyMinutes * 60,
    weeklyTargetSeconds: goal.weeklyMinutes * 60,
  };
}

function closeOpenPause(session: FocusSession, now: string): FocusSession {
  if (session.status !== "paused") return session;
  const pause = session.pauses.at(-1);
  if (!pause || pause.endedAt) throw new ValidationError("Focus pause state is incomplete.");
  return {
    ...session,
    accumulatedPausedSeconds:
      session.accumulatedPausedSeconds + secondsBetween(pause.startedAt, now),
    pauses: [...session.pauses.slice(0, -1), { ...pause, endedAt: now }],
  };
}

function boundedNow(session: FocusSession, value: string): string {
  instant(value, "Current time");
  return Date.parse(value) < Date.parse(session.startedAt) ? session.startedAt : value;
}

function secondsBetween(start: string, end: string): number {
  instant(start, "Start");
  instant(end, "End");
  return Math.max(0, Math.floor((Date.parse(end) - Date.parse(start)) / 1_000));
}

function requireStatus(session: FocusSession, status: FocusStatus): void {
  if (session.status !== status)
    throw new ValidationError(`Focus session must be ${status} for this transition.`);
}

function requireDuration(value: number | null): number {
  if (value === null || !Number.isInteger(value) || value <= 0 || value > 31_536_000)
    throw new ValidationError("Focus duration is invalid.");
  return value;
}

function required(value: string, label: string): string {
  if (!value.trim()) throw new ValidationError(`${label} is required.`);
  return value;
}

function optionalText(value: string | null | undefined, maximum: number): string | null {
  if (value === null || value === undefined || value.trim() === "") return null;
  if (value.length > maximum) throw new ValidationError("Focus text is too long.");
  return value.trim();
}

function instant(value: string, label: string): void {
  if (!/^\d{4}-\d{2}-\d{2}T.*Z$/u.test(value) || !Number.isFinite(Date.parse(value)))
    throw new ValidationError(`${label} must be an ISO instant.`);
}

function add(target: Record<string, number>, key: string, value: number): void {
  target[key] = (target[key] ?? 0) + value;
}

function localPart(instantValue: string, timezone: string, part: "date" | "hour"): string {
  const pieces = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instantValue));
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    pieces.find((piece) => piece.type === type)?.value ?? "";
  return part === "date" ? `${get("year")}-${get("month")}-${get("day")}` : `${get("hour")}:00`;
}
