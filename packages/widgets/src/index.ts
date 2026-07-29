export const WIDGET_SNAPSHOT_VERSION = 1 as const;
export const WIDGET_ACTION_VERSION = 1 as const;
export const MAX_WIDGET_TASKS = 8;
export const MAX_WIDGET_AGENDA_ITEMS = 8;
export const MAX_PENDING_WIDGET_ACTIONS = 32;
export const WIDGET_ACTION_MAX_AGE_MS = 24 * 60 * 60 * 1_000;

export type WidgetLocale = "en" | "tr";
export type WidgetPrivacy = "counts_only" | "titles" | "titles_and_context";
export type WidgetActionType =
  "complete_task" | "reopen_task" | "start_focus" | "pause_focus" | "resume_focus" | "finish_focus";

export interface WidgetTaskSummary {
  id: string;
  title: string;
  completed: boolean;
  revision: number;
  dueLabel: string | null;
  priority: "none" | "low" | "medium" | "high";
  projectName: string | null;
}

export interface WidgetAgendaSummary {
  id: string;
  kind: "event" | "task_block" | "deadline";
  title: string;
  startAt: string | null;
  endAt: string | null;
  allDay: boolean;
  projectName: string | null;
}

export interface WidgetFocusSummary {
  sessionId: string;
  mode: "stopwatch" | "countdown" | "pomodoro";
  phase: "focus" | "short_break" | "long_break";
  status: "running" | "paused";
  startedAt: string;
  plannedDurationSeconds: number | null;
  accumulatedPausedSeconds: number;
  pausedAt: string | null;
  contextTitle: string | null;
  revision: number;
}

export interface WidgetSnapshot {
  schemaVersion: typeof WIDGET_SNAPSHOT_VERSION;
  generatedAt: string;
  lastSuccessfulRefreshAt: string;
  locale: WidgetLocale;
  timezone: string;
  staleAfter: string;
  privacy: WidgetPrivacy;
  authenticated: boolean;
  todayRemainingCount: number;
  todayTasks: readonly WidgetTaskSummary[];
  agenda: readonly WidgetAgendaSummary[];
  focus: WidgetFocusSummary | null;
  dailyGoalSeconds: number;
  dailyFocusedSeconds: number;
  quickActionsEnabled: boolean;
}

export interface WidgetAction {
  schemaVersion: typeof WIDGET_ACTION_VERSION;
  id: string;
  type: WidgetActionType;
  targetId: string | null;
  createdAt: string;
  expectedRevision: number;
  idempotencyKey: string;
  status: "pending" | "processing" | "completed" | "failed";
}

export interface WidgetActionQueue {
  schemaVersion: typeof WIDGET_ACTION_VERSION;
  actions: readonly WidgetAction[];
}

export type StoneDeepLink =
  | { route: "today" }
  | { route: "focus" }
  | { route: "new_task" }
  | { route: "new_note" }
  | { route: "new_event" }
  | { route: "task"; id: string }
  | { route: "project"; id: string }
  | { route: "calendar_date"; date: string }
  | { route: "calendar_event"; id: string };

export function parseWidgetSnapshot(value: unknown): WidgetSnapshot {
  assertNoCredentialFields(value);
  const record = object(value, "snapshot");
  exactVersion(record, WIDGET_SNAPSHOT_VERSION, "snapshot");
  const tasks = array(record.todayTasks, "todayTasks", MAX_WIDGET_TASKS).map(parseTask);
  const agenda = array(record.agenda, "agenda", MAX_WIDGET_AGENDA_ITEMS).map(parseAgenda);
  const snapshot: WidgetSnapshot = {
    schemaVersion: WIDGET_SNAPSHOT_VERSION,
    generatedAt: instant(record.generatedAt, "generatedAt"),
    lastSuccessfulRefreshAt: instant(record.lastSuccessfulRefreshAt, "lastSuccessfulRefreshAt"),
    locale: oneOf(record.locale, ["en", "tr"] as const, "locale"),
    timezone: text(record.timezone, 100, "timezone"),
    staleAfter: instant(record.staleAfter, "staleAfter"),
    privacy: oneOf(
      record.privacy,
      ["counts_only", "titles", "titles_and_context"] as const,
      "privacy",
    ),
    authenticated: boolean(record.authenticated, "authenticated"),
    todayRemainingCount: integer(record.todayRemainingCount, 0, 100_000, "todayRemainingCount"),
    todayTasks: tasks,
    agenda,
    focus: record.focus === null ? null : parseFocus(record.focus),
    dailyGoalSeconds: integer(record.dailyGoalSeconds, 0, 604_800, "dailyGoalSeconds"),
    dailyFocusedSeconds: integer(record.dailyFocusedSeconds, 0, 604_800, "dailyFocusedSeconds"),
    quickActionsEnabled: boolean(record.quickActionsEnabled, "quickActionsEnabled"),
  };
  if (!snapshot.authenticated && (tasks.length || agenda.length || snapshot.focus))
    throw new Error("Logged-out widget snapshot cannot contain private records.");
  return snapshot;
}

const FORBIDDEN_WIDGET_FIELD =
  /^(?:access|refresh|firebase|github)?token$|^(?:api|encryption)?key$|^(?:credential|password|markdown|notebody)$/iu;

function assertNoCredentialFields(value: unknown, depth = 0): void {
  if (depth > 6 || value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) assertNoCredentialFields(item, depth + 1);
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_WIDGET_FIELD.test(key.replaceAll("_", "")))
      throw new Error("Widget snapshots cannot contain credentials or note bodies.");
    assertNoCredentialFields(child, depth + 1);
  }
}

export function safeWidgetSnapshot(
  value: unknown,
  now: string,
): { snapshot: WidgetSnapshot | null; stale: boolean } {
  try {
    const snapshot = parseWidgetSnapshot(value);
    return { snapshot, stale: Date.parse(now) >= Date.parse(snapshot.staleAfter) };
  } catch {
    return { snapshot: null, stale: true };
  }
}

export function redactWidgetSnapshot(
  source: WidgetSnapshot,
  privacy: WidgetPrivacy,
): WidgetSnapshot {
  const redactTitle = privacy === "counts_only";
  const redactContext = privacy !== "titles_and_context";
  return {
    ...source,
    privacy,
    todayTasks: source.todayTasks.map((task) => ({
      ...task,
      title: redactTitle ? "" : task.title,
      projectName: redactContext ? null : task.projectName,
    })),
    agenda: source.agenda.map((item) => ({
      ...item,
      title: redactTitle ? "" : item.title,
      projectName: redactContext ? null : item.projectName,
    })),
    focus:
      source.focus === null
        ? null
        : { ...source.focus, contextTitle: redactContext ? null : source.focus.contextTitle },
  };
}

export function parseWidgetAction(value: unknown): WidgetAction {
  const record = object(value, "action");
  exactVersion(record, WIDGET_ACTION_VERSION, "action");
  return {
    schemaVersion: WIDGET_ACTION_VERSION,
    id: identifier(record.id, "id"),
    type: oneOf(
      record.type,
      [
        "complete_task",
        "reopen_task",
        "start_focus",
        "pause_focus",
        "resume_focus",
        "finish_focus",
      ] as const,
      "type",
    ),
    targetId: record.targetId === null ? null : identifier(record.targetId, "targetId"),
    createdAt: instant(record.createdAt, "createdAt"),
    expectedRevision: integer(record.expectedRevision, 0, 2_147_483_647, "expectedRevision"),
    idempotencyKey: identifier(record.idempotencyKey, "idempotencyKey"),
    status: oneOf(
      record.status,
      ["pending", "processing", "completed", "failed"] as const,
      "status",
    ),
  };
}

export function parseWidgetActionQueue(value: unknown): WidgetActionQueue {
  const record = object(value, "actionQueue");
  exactVersion(record, WIDGET_ACTION_VERSION, "actionQueue");
  const actions = array(record.actions, "actions", MAX_PENDING_WIDGET_ACTIONS).map(
    parseWidgetAction,
  );
  if (new Set(actions.map((action) => action.id)).size !== actions.length)
    throw new Error("Widget action IDs must be unique.");
  if (new Set(actions.map((action) => action.idempotencyKey)).size !== actions.length)
    throw new Error("Widget action idempotency keys must be unique.");
  return { schemaVersion: WIDGET_ACTION_VERSION, actions };
}

export function enqueueWidgetAction(
  queue: WidgetActionQueue,
  source: WidgetAction,
  now: string,
): WidgetActionQueue {
  const action = parseWidgetAction(source);
  const retained = queue.actions.filter(
    (candidate) =>
      candidate.status !== "completed" &&
      Date.parse(now) - Date.parse(candidate.createdAt) <= WIDGET_ACTION_MAX_AGE_MS,
  );
  if (
    retained.some(
      (candidate) =>
        candidate.id === action.id || candidate.idempotencyKey === action.idempotencyKey,
    )
  )
    return { schemaVersion: WIDGET_ACTION_VERSION, actions: retained };
  return {
    schemaVersion: WIDGET_ACTION_VERSION,
    actions: [...retained, action].slice(-MAX_PENDING_WIDGET_ACTIONS),
  };
}

export function pendingWidgetActions(
  queue: WidgetActionQueue,
  now: string,
): readonly WidgetAction[] {
  return parseWidgetActionQueue(queue).actions.filter(
    (action) =>
      action.status === "pending" &&
      Date.parse(now) - Date.parse(action.createdAt) <= WIDGET_ACTION_MAX_AGE_MS,
  );
}

export function parseStoneDeepLink(url: string): StoneDeepLink | null {
  if (/(?:^|\/)(?:\.{1,2})(?:\/|$)/u.test(url)) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "stone:" || parsed.username || parsed.password || parsed.port)
    return null;
  const parts = [parsed.hostname, ...parsed.pathname.split("/")].filter(Boolean);
  if (parsed.search || parsed.hash) return null;
  if (parts.length === 1) {
    const route = parts[0];
    if (
      route === "today" ||
      route === "focus" ||
      route === "new_task" ||
      route === "new_note" ||
      route === "new_event"
    )
      return { route };
  }
  if (parts.length !== 2) return null;
  const [route, rawValue] = parts;
  const value = rawValue ? decodeURIComponent(rawValue) : "";
  if (route === "task" && validIdentifier(value)) return { route, id: value };
  if (route === "project" && validIdentifier(value)) return { route, id: value };
  if (route === "calendar" && /^\d{4}-\d{2}-\d{2}$/u.test(value))
    return { route: "calendar_date", date: value };
  if (route === "event" && validIdentifier(value)) return { route: "calendar_event", id: value };
  return null;
}

function parseTask(value: unknown): WidgetTaskSummary {
  const record = object(value, "task");
  return {
    id: identifier(record.id, "task.id"),
    title: text(record.title, 160, "task.title"),
    completed: boolean(record.completed, "task.completed"),
    revision: integer(record.revision, 1, 2_147_483_647, "task.revision"),
    dueLabel: record.dueLabel === null ? null : text(record.dueLabel, 80, "task.dueLabel"),
    priority: oneOf(record.priority, ["none", "low", "medium", "high"] as const, "task.priority"),
    projectName:
      record.projectName === null ? null : text(record.projectName, 120, "task.projectName"),
  };
}

function parseAgenda(value: unknown): WidgetAgendaSummary {
  const record = object(value, "agenda item");
  return {
    id: identifier(record.id, "agenda.id"),
    kind: oneOf(record.kind, ["event", "task_block", "deadline"] as const, "agenda.kind"),
    title: text(record.title, 160, "agenda.title"),
    startAt: record.startAt === null ? null : instant(record.startAt, "agenda.startAt"),
    endAt: record.endAt === null ? null : instant(record.endAt, "agenda.endAt"),
    allDay: boolean(record.allDay, "agenda.allDay"),
    projectName:
      record.projectName === null ? null : text(record.projectName, 120, "agenda.projectName"),
  };
}

function parseFocus(value: unknown): WidgetFocusSummary {
  const record = object(value, "focus");
  return {
    sessionId: identifier(record.sessionId, "focus.sessionId"),
    mode: oneOf(record.mode, ["stopwatch", "countdown", "pomodoro"] as const, "focus.mode"),
    phase: oneOf(record.phase, ["focus", "short_break", "long_break"] as const, "focus.phase"),
    status: oneOf(record.status, ["running", "paused"] as const, "focus.status"),
    startedAt: instant(record.startedAt, "focus.startedAt"),
    plannedDurationSeconds:
      record.plannedDurationSeconds === null
        ? null
        : integer(record.plannedDurationSeconds, 1, 31_536_000, "focus.plannedDurationSeconds"),
    accumulatedPausedSeconds: integer(
      record.accumulatedPausedSeconds,
      0,
      31_536_000,
      "focus.accumulatedPausedSeconds",
    ),
    pausedAt: record.pausedAt === null ? null : instant(record.pausedAt, "focus.pausedAt"),
    contextTitle:
      record.contextTitle === null ? null : text(record.contextTitle, 160, "focus.contextTitle"),
    revision: integer(record.revision, 1, 2_147_483_647, "focus.revision"),
  };
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function exactVersion(value: Record<string, unknown>, expected: number, label: string): void {
  if (value.schemaVersion !== expected) throw new Error(`Unsupported ${label} schema version.`);
}

function array(value: unknown, label: string, maximum: number): readonly unknown[] {
  if (!Array.isArray(value) || value.length > maximum)
    throw new Error(`${label} must be a bounded array.`);
  return value;
}

function text(value: unknown, maximum: number, label: string): string {
  if (typeof value !== "string" || value.length > maximum) throw new Error(`${label} is invalid.`);
  return value;
}

function identifier(value: unknown, label: string): string {
  if (typeof value !== "string" || !validIdentifier(value)) throw new Error(`${label} is invalid.`);
  return value;
}

function validIdentifier(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(value);
}

function integer(value: unknown, minimum: number, maximum: number, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > maximum)
    throw new Error(`${label} is invalid.`);
  return value;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} is invalid.`);
  return value;
}

function instant(value: unknown, label: string): string {
  const result = text(value, 40, label);
  if (!Number.isFinite(Date.parse(result))) throw new Error(`${label} is invalid.`);
  return result;
}

function oneOf<const T extends readonly string[]>(
  value: unknown,
  values: T,
  label: string,
): T[number] {
  if (typeof value !== "string" || !(values as readonly string[]).includes(value))
    throw new Error(`${label} is invalid.`);
  return value;
}
