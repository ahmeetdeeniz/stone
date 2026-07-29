export const SCOPES = [
  "stone.read.notes",
  "stone.read.projects",
  "stone.read.tasks",
  "stone.read.calendar",
  "stone.read.focus",
  "stone.write.notes",
  "stone.write.projects",
  "stone.write.tasks",
  "stone.write.calendar",
  "stone.write.focus",
] as const;

export type StoneScope = (typeof SCOPES)[number];

export interface AuthContext {
  userId: string;
  clientId: string;
  scopes: readonly StoneScope[];
}

export interface DocumentRecord {
  id: string;
  ownerId: string;
  kind: string;
  title: string;
  markdown: string;
  path: string | null;
  projectId: string | null;
  isPinned: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  updatedByDeviceId: string;
  [key: string]: unknown;
}

export interface ProjectRecord {
  id: string;
  ownerId: string;
  canonicalDocumentId: string;
  title: string;
  slug: string;
  status: string;
  priority: string;
  tags: string[];
  targetDate: string | null;
  currentVersion: string | null;
  nextVersion: string | null;
  nextAction: string | null;
  repositoryUrl: string | null;
  platforms: string[];
  health: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  updatedByDeviceId: string;
  [key: string]: unknown;
}

export interface VersionRecord {
  id: string;
  ownerId: string;
  projectId: string;
  canonicalDocumentId: string;
  version: string;
  status: string;
  targetDate: string | null;
  androidStatus: string;
  iosStatus: string;
  completedTasks: number;
  totalTasks: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  updatedByDeviceId: string;
  [key: string]: unknown;
}

export interface TaskRecord {
  id: string;
  ownerId: string;
  schemaVersion: 1;
  title: string;
  description: string | null;
  state: "open" | "completed" | "cancelled";
  completedAt: string | null;
  dueDate: string | null;
  dueTime: string | null;
  timezone: string;
  priority: "none" | "low" | "medium" | "high";
  sortOrder: number;
  tags: string[];
  projectId: string | null;
  sourceDocumentId: string | null;
  sourceBlockId: string | null;
  parentTaskId: string | null;
  estimatedMinutes: number | null;
  recurrence: Record<string, unknown> | null;
  recurrenceSeriesId: string | null;
  occurrenceDate: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  updatedByDeviceId: string;
  [key: string]: unknown;
}

export interface CalendarRecord {
  id: string;
  ownerId: string;
  schemaVersion: 1;
  kind: "event" | "task_block";
  title: string;
  description: string | null;
  allDay: boolean;
  startDate: string;
  endDate: string;
  startAt: string | null;
  endAt: string | null;
  timezone: string;
  location: string | null;
  category: string;
  projectId: string | null;
  sourceDocumentId: string | null;
  taskId: string | null;
  planningNote: string | null;
  recurrence: Record<string, unknown> | null;
  recurrenceSeriesId: string | null;
  recurrenceId: string | null;
  overrides: Record<string, unknown>[];
  externalUid: string | null;
  cancelledAt: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  updatedByDeviceId: string;
  [key: string]: unknown;
}

export interface FocusRecord {
  id: string;
  ownerId: string;
  schemaVersion: 1;
  mode: "stopwatch" | "countdown" | "pomodoro";
  status: "running" | "paused" | "completed" | "cancelled";
  phase: "focus" | "short_break" | "long_break";
  startedAt: string;
  endedAt: string | null;
  plannedDurationSeconds: number | null;
  actualFocusSeconds: number;
  accumulatedPausedSeconds: number;
  pauses: { startedAt: string; endedAt: string | null }[];
  manuallyAdjustedSeconds: number | null;
  taskId: string | null;
  projectId: string | null;
  sourceDocumentId: string | null;
  calendarItemId: string | null;
  category: string | null;
  tags: string[];
  note: string | null;
  pomodoroGroupId: string | null;
  pomodoroCycle: number | null;
  activeDeviceId: string;
  conflictState: "none" | "overlap_unresolved" | "resolved_include" | "resolved_exclude";
  revision: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  updatedByDeviceId: string;
  [key: string]: unknown;
}

export interface FocusGoalRecord {
  id: string;
  ownerId: string;
  schemaVersion: 1;
  timezone: string;
  dailyMinutes: number;
  weeklyMinutes: number;
  effectiveFromDate: string;
  streakVisible: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  updatedByDeviceId: string;
  [key: string]: unknown;
}

export interface ListFocusOptions {
  startAt: string;
  endAt: string;
  status?: FocusRecord["status"];
  cursorKey?: string;
  pageToken?: string;
  limit: number;
}

export interface Page<T> {
  items: readonly T[];
  nextPageToken: string | null;
}

export interface ListDocumentsOptions {
  kind?: string;
  projectId?: string | undefined;
  includeDeleted?: boolean | undefined;
  cursorKey?: string | undefined;
  pageToken?: string | undefined;
  limit: number;
}

export interface ListProjectsOptions {
  status?: string | undefined;
  tag?: string | undefined;
  priority?: string | undefined;
  health?: string | undefined;
  cursorKey?: string | undefined;
  pageToken?: string | undefined;
  limit: number;
}

export interface ListVersionsOptions {
  projectId?: string | undefined;
  cursorKey?: string | undefined;
  pageToken?: string | undefined;
  limit: number;
}

export interface ListTasksOptions {
  state?: TaskRecord["state"] | undefined;
  projectId?: string | undefined;
  dueBefore?: string | undefined;
  dueAfter?: string | undefined;
  search?: string | undefined;
  includeDeleted?: boolean | undefined;
  cursorKey?: string | undefined;
  pageToken?: string | undefined;
  limit: number;
}

export interface ListCalendarOptions {
  startDate: string;
  endDate: string;
  projectId?: string | undefined;
  kind?: CalendarRecord["kind"] | undefined;
  includeDeleted?: boolean | undefined;
  cursorKey?: string | undefined;
  pageToken?: string | undefined;
  limit: number;
}

export interface AuditEntry {
  id: string;
  ownerId: string;
  tool: string;
  inputSummary: Record<string, unknown>;
  affectedEntities: readonly string[];
  beforeRevision: number | null;
  afterRevision: number | null;
  confirmation: Record<string, unknown> | null;
  createdAt: string;
}

export interface StoredIdempotencyResult {
  idempotencyKey: string;
  tool: string;
  result: Record<string, unknown>;
  createdAt: string;
}

export interface DocumentWriteInput {
  ownerId: string;
  documentId: string;
  expectedRevision: number;
  idempotencyKey: string;
  tool: string;
  confirmation: Record<string, unknown> | null;
  inputSummary: Record<string, unknown>;
  mutate: (current: DocumentRecord | null) => DocumentRecord;
}

export interface ProjectWriteInput {
  ownerId: string;
  projectId: string;
  expectedRevision: number;
  idempotencyKey: string;
  tool: string;
  confirmation: Record<string, unknown> | null;
  inputSummary: Record<string, unknown>;
  mutate: (current: ProjectRecord | null) => ProjectRecord;
}

export interface VersionWriteInput {
  ownerId: string;
  versionId: string;
  expectedRevision: number;
  idempotencyKey: string;
  tool: string;
  confirmation: Record<string, unknown> | null;
  inputSummary: Record<string, unknown>;
  mutate: (current: VersionRecord | null) => VersionRecord;
}

export interface TaskWriteInput {
  ownerId: string;
  taskId: string;
  expectedRevision: number;
  idempotencyKey: string;
  tool: string;
  confirmation: Record<string, unknown> | null;
  inputSummary: Record<string, unknown>;
  mutate: (current: TaskRecord | null) => TaskRecord;
}
export interface CalendarWriteInput {
  ownerId: string;
  calendarId: string;
  expectedRevision: number;
  idempotencyKey: string;
  tool: string;
  confirmation: Record<string, unknown> | null;
  inputSummary: Record<string, unknown>;
  mutate: (current: CalendarRecord | null) => CalendarRecord;
}

export interface FocusWriteInput {
  ownerId: string;
  focusId: string;
  expectedRevision: number;
  idempotencyKey: string;
  tool: string;
  confirmation: Record<string, unknown> | null;
  inputSummary: Record<string, unknown>;
  mutate: (current: FocusRecord | null) => FocusRecord;
}

export interface FocusGoalWriteInput {
  ownerId: string;
  goalId: string;
  expectedRevision: number;
  idempotencyKey: string;
  tool: string;
  confirmation: Record<string, unknown> | null;
  inputSummary: Record<string, unknown>;
  mutate: (current: FocusGoalRecord | null) => FocusGoalRecord;
}

export interface WriteResult<T> {
  entity: T;
  replayed: boolean;
  beforeRevision: number | null;
  afterRevision: number;
}

export interface StoneStore {
  getDocument(ownerId: string, id: string): Promise<DocumentRecord | null>;
  listDocuments(ownerId: string, options: ListDocumentsOptions): Promise<Page<DocumentRecord>>;
  getProject(ownerId: string, id: string): Promise<ProjectRecord | null>;
  listProjects(ownerId: string, options: ListProjectsOptions): Promise<Page<ProjectRecord>>;
  listVersions(ownerId: string, options: ListVersionsOptions): Promise<Page<VersionRecord>>;
  getTask(ownerId: string, id: string): Promise<TaskRecord | null>;
  listTasks(ownerId: string, options: ListTasksOptions): Promise<Page<TaskRecord>>;
  getCalendar(ownerId: string, id: string): Promise<CalendarRecord | null>;
  listCalendar(ownerId: string, options: ListCalendarOptions): Promise<Page<CalendarRecord>>;
  getFocus(ownerId: string, id: string): Promise<FocusRecord | null>;
  listFocus(ownerId: string, options: ListFocusOptions): Promise<Page<FocusRecord>>;
  getFocusGoal(ownerId: string): Promise<FocusGoalRecord | null>;
  writeDocument(input: DocumentWriteInput): Promise<WriteResult<DocumentRecord>>;
  writeProject(input: ProjectWriteInput): Promise<WriteResult<ProjectRecord>>;
  writeVersion(input: VersionWriteInput): Promise<WriteResult<VersionRecord>>;
  writeTask(input: TaskWriteInput): Promise<WriteResult<TaskRecord>>;
  writeCalendar(input: CalendarWriteInput): Promise<WriteResult<CalendarRecord>>;
  writeFocus(input: FocusWriteInput): Promise<WriteResult<FocusRecord>>;
  writeFocusGoal(input: FocusGoalWriteInput): Promise<WriteResult<FocusGoalRecord>>;
  listAudit(ownerId: string, limit: number): Promise<readonly AuditEntry[]>;
}

export class McpInputError extends Error {
  public readonly code = "invalid_input";
}

export class McpUnauthorizedError extends Error {
  public readonly code = "unauthorized";
}

export class McpForbiddenError extends Error {
  public readonly code = "forbidden";
}

export class McpNotFoundError extends Error {
  public readonly code = "not_found";
}

export class McpRevisionConflictError extends Error {
  public readonly code = "revision_conflict";
  public readonly currentRevision: number;

  public constructor(currentRevision: number) {
    super(`expectedRevision does not match current revision ${currentRevision}.`);
    this.currentRevision = currentRevision;
  }
}

export class McpRateLimitError extends Error {
  public readonly code = "rate_limited";

  public constructor(public readonly retryAfterSeconds: number) {
    super("Rate limit exceeded.");
  }
}
