export type DocumentKind =
  "note" | "project" | "version" | "decision_log" | "inbox" | "release_checklist";

export type ProjectStatus =
  | "idea"
  | "planning"
  | "development"
  | "testing"
  | "store_process"
  | "live"
  | "update_needed"
  | "maintenance"
  | "paused"
  | "archived";

export type ProjectPriority = "low" | "medium" | "high" | "critical";
export type ProjectPlatform = "android" | "ios" | "windows" | "web" | "other";
export type PlatformReleaseStatus =
  | "not_planned"
  | "preparing"
  | "internal_testing"
  | "external_testing"
  | "review"
  | "live"
  | "paused"
  | "rejected";
export type ProjectHealth = "good" | "attention" | "risk" | "paused";
export type ThemePreference = "system" | "light" | "dark";
export type TaskState = "open" | "completed" | "cancelled";
export type TaskPriority = "none" | "low" | "medium" | "high";
export type TaskRecurrenceFrequency = "daily" | "weekdays" | "weekly" | "monthly" | "custom";
export type TaskRecurrenceUnit = "day" | "week" | "month";
export type CalendarItemKind = "event" | "task_block";
export type CalendarCategory = "neutral" | "purple" | "blue" | "green" | "amber" | "red";
export type CalendarRecurrenceEditScope = "occurrence" | "future" | "series";
export type FocusMode = "stopwatch" | "countdown" | "pomodoro";
export type FocusStatus = "running" | "paused" | "completed" | "cancelled";
export type FocusPhase = "focus" | "short_break" | "long_break";
export type FocusConflictState =
  "none" | "overlap_unresolved" | "resolved_include" | "resolved_exclude";

export interface FocusPauseInterval {
  startedAt: string;
  endedAt: string | null;
}

export interface FocusSession extends SyncFields {
  schemaVersion: 1;
  mode: FocusMode;
  status: FocusStatus;
  phase: FocusPhase;
  startedAt: string;
  endedAt: string | null;
  plannedDurationSeconds: number | null;
  actualFocusSeconds: number;
  accumulatedPausedSeconds: number;
  pauses: readonly FocusPauseInterval[];
  manuallyAdjustedSeconds: number | null;
  taskId: string | null;
  projectId: string | null;
  sourceDocumentId: string | null;
  calendarItemId: string | null;
  category: string | null;
  tags: readonly string[];
  note: string | null;
  pomodoroGroupId: string | null;
  pomodoroCycle: number | null;
  activeDeviceId: string;
  conflictState: FocusConflictState;
}

export interface FocusGoal extends SyncFields {
  schemaVersion: 1;
  timezone: string;
  dailyMinutes: number;
  weeklyMinutes: number;
  effectiveFromDate: string;
  streakVisible: boolean;
}

export interface FocusSessionListOptions {
  startAt: string;
  endAt: string;
  status?: FocusStatus;
  taskId?: string;
  projectId?: string;
  includeDeleted?: boolean;
  limit?: number;
}

export interface FocusRepository {
  create(session: FocusSession): Promise<FocusSession>;
  getById(ownerId: string, id: string, includeDeleted?: boolean): Promise<FocusSession | null>;
  getActive(ownerId: string): Promise<readonly FocusSession[]>;
  list(ownerId: string, options: FocusSessionListOptions): Promise<readonly FocusSession[]>;
  save(
    ownerId: string,
    session: FocusSession,
    expectedRevision: number,
    deviceId: string,
  ): Promise<FocusSession>;
  softDelete(ownerId: string, id: string, deviceId: string): Promise<FocusSession>;
  getGoal(ownerId: string): Promise<FocusGoal | null>;
  saveGoal(goal: FocusGoal, expectedRevision: number | null): Promise<FocusGoal>;
}

export interface TaskRecurrence {
  frequency: TaskRecurrenceFrequency;
  interval: number;
  unit: TaskRecurrenceUnit;
  preferredDayOfMonth: number | null;
}

export interface Task extends SyncFields {
  schemaVersion: 1;
  title: string;
  description: string | null;
  state: TaskState;
  completedAt: string | null;
  dueDate: string | null;
  dueTime: string | null;
  timezone: string;
  priority: TaskPriority;
  sortOrder: number;
  tags: readonly string[];
  projectId: string | null;
  sourceDocumentId: string | null;
  sourceBlockId: string | null;
  parentTaskId: string | null;
  estimatedMinutes: number | null;
  recurrence: TaskRecurrence | null;
  recurrenceSeriesId: string | null;
  occurrenceDate: string | null;
}

export interface TaskOccurrence {
  id: string;
  ownerId: string;
  taskId: string;
  seriesId: string;
  scheduledDate: string;
  completedAt: string;
  taskSnapshot: Task;
}

export interface CalendarRecurrence {
  frequency: TaskRecurrenceFrequency;
  interval: number;
  unit: TaskRecurrenceUnit;
  preferredDayOfMonth: number | null;
  untilDate: string | null;
}

export interface CalendarOccurrenceOverride {
  occurrenceDate: string;
  cancelled: boolean;
  title: string | null;
  startAt: string | null;
  endAt: string | null;
}

export interface CalendarItem extends SyncFields {
  schemaVersion: 1;
  kind: CalendarItemKind;
  title: string;
  description: string | null;
  allDay: boolean;
  startDate: string;
  endDate: string;
  startAt: string | null;
  endAt: string | null;
  timezone: string;
  location: string | null;
  category: CalendarCategory;
  projectId: string | null;
  sourceDocumentId: string | null;
  taskId: string | null;
  planningNote: string | null;
  recurrence: CalendarRecurrence | null;
  recurrenceSeriesId: string | null;
  recurrenceId: string | null;
  overrides: readonly CalendarOccurrenceOverride[];
  externalUid: string | null;
  cancelledAt: string | null;
}

export interface CalendarOccurrence {
  id: string;
  itemId: string;
  seriesId: string | null;
  occurrenceDate: string;
  item: CalendarItem;
}

export interface CalendarListOptions {
  startDate: string;
  endDate: string;
  projectId?: string;
  kind?: CalendarItemKind;
  category?: CalendarCategory;
  taskCompleted?: boolean;
  search?: string;
  includeDeleted?: boolean;
  limit?: number;
}

export interface CalendarRepository {
  create(item: CalendarItem): Promise<CalendarItem>;
  getById(ownerId: string, id: string, includeDeleted?: boolean): Promise<CalendarItem | null>;
  list(ownerId: string, options: CalendarListOptions): Promise<readonly CalendarItem[]>;
  save(
    ownerId: string,
    item: CalendarItem,
    expectedRevision: number,
    deviceId: string,
  ): Promise<CalendarItem>;
  softDelete(ownerId: string, id: string, deviceId: string): Promise<CalendarItem>;
}

export interface TaskListOptions {
  state?: TaskState;
  projectId?: string;
  parentTaskId?: string | null;
  due?: "today" | "upcoming" | "overdue";
  today?: string;
  search?: string;
  priority?: TaskPriority;
  tags?: readonly string[];
  includeDeleted?: boolean;
  limit?: number;
}

export interface TaskRepository {
  create(task: Task): Promise<Task>;
  getById(ownerId: string, id: string, includeDeleted?: boolean): Promise<Task | null>;
  list(ownerId: string, options?: TaskListOptions): Promise<readonly Task[]>;
  save(ownerId: string, task: Task, expectedRevision: number, deviceId: string): Promise<Task>;
  complete(
    ownerId: string,
    id: string,
    completedAt: string,
    deviceId: string,
  ): Promise<{ task: Task; nextTask: Task | null }>;
  reopen(ownerId: string, id: string, deviceId: string): Promise<Task>;
  softDelete(ownerId: string, id: string, deviceId: string): Promise<Task>;
  reorder(
    ownerId: string,
    parentTaskId: string | null,
    orderedIds: readonly string[],
    deviceId: string,
  ): Promise<readonly Task[]>;
  occurrences(ownerId: string, seriesId: string): Promise<readonly TaskOccurrence[]>;
}

export interface SyncFields {
  id: string;
  ownerId: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  updatedByDeviceId: string;
}

export interface Document extends SyncFields {
  kind: DocumentKind;
  title: string;
  markdown: string;
  path: string | null;
  projectId: string | null;
  isPinned: boolean;
}

export interface Drawing extends SyncFields {
  documentId: string | null;
  title: string;
  sourcePath: string;
  previewPath: string;
  sourceSha256: string;
  previewSha256: string;
  sourceSize: number;
  previewSize: number;
}

export interface DrawingRevision {
  id: string;
  drawingId: string;
  revision: number;
  sourcePath: string;
  previewPath: string;
  createdAt: string;
}

export interface DrawingRepository {
  getById(ownerId: string, id: string, includeDeleted?: boolean): Promise<Drawing | null>;
  list(ownerId: string, documentId?: string): Promise<readonly Drawing[]>;
  save(drawing: Drawing, source: string, previewPath: string, deviceId: string): Promise<Drawing>;
  softDelete(ownerId: string, id: string, deviceId: string): Promise<Drawing>;
  revisions(ownerId: string, id: string): Promise<readonly DrawingRevision[]>;
}

export interface Device {
  id: string;
  ownerId: string;
  platform: "android" | "ios" | "windows";
  name: string;
  appVersion: string;
  lastSeenAt: string;
}

export interface UserSettings {
  ownerId: string;
  theme: ThemePreference;
  reduceMotion: boolean;
  editorFontSize: number;
  trashRetentionDays: number;
}

export interface Repository<T> {
  getById(id: string): Promise<T | null>;
  list(): Promise<readonly T[]>;
}

export interface SettingsRepository {
  get(ownerId: string): Promise<UserSettings>;
  save(settings: UserSettings): Promise<void>;
}

export interface NoteListOptions {
  includeDeleted?: boolean;
  pinnedOnly?: boolean;
  search?: string;
  limit?: number;
}

export interface DocumentRevision {
  id: string;
  documentId: string;
  revision: number;
  markdown: string;
  createdAt: string;
}

export interface NoteDraft {
  documentId: string;
  ownerId: string;
  markdown: string;
  updatedAt: string;
  selectionFrom: number;
  selectionTo: number;
}

export interface Project extends SyncFields {
  canonicalDocumentId: string;
  title: string;
  slug: string;
  status: ProjectStatus;
  priority: ProjectPriority;
  tags: readonly string[];
  targetDate: string | null;
  currentVersion: string | null;
  nextVersion: string | null;
  nextAction: string | null;
  repositoryUrl: string | null;
  platforms: readonly ProjectPlatform[];
  health: ProjectHealth;
}

export interface ProjectVersion extends SyncFields {
  projectId: string;
  canonicalDocumentId: string;
  version: string;
  status: ProjectStatus;
  targetDate: string | null;
  androidStatus: PlatformReleaseStatus;
  iosStatus: PlatformReleaseStatus;
  completedTasks: number;
  totalTasks: number;
}

export interface ProjectTask {
  id: string;
  ownerId: string;
  documentId: string;
  projectId: string | null;
  versionId: string | null;
  lineAnchor: string;
  text: string;
  completed: boolean;
  priority: ProjectPriority | null;
  dueDate: string | null;
  blocked: boolean;
  blockerText: string | null;
  canceled: boolean;
  revision: number;
  updatedAt: string;
}

export interface ProjectBlocker {
  id: string;
  projectId: string;
  taskId: string | null;
  text: string;
  resolved: boolean;
  createdAt: string;
  resolvedAt: string | null;
}

export interface ProjectDecision {
  id: string;
  projectId: string;
  title: string;
  date: string;
  decision: string;
  reason: string;
  alternatives: string;
  outcome: string;
}

export interface ProjectListOptions {
  includeArchived?: boolean;
  status?: ProjectStatus;
  priority?: ProjectPriority;
  tag?: string;
  platform?: ProjectPlatform;
  search?: string;
}

export interface ProjectCreateInput {
  project: Project;
  documents: readonly Document[];
}

export interface ProjectUpdate {
  title?: string;
  status?: ProjectStatus;
  priority?: ProjectPriority;
  tags?: readonly string[];
  targetDate?: string | null;
  currentVersion?: string | null;
  nextVersion?: string | null;
  nextAction?: string | null;
  repositoryUrl?: string | null;
  platforms?: readonly ProjectPlatform[];
}

export interface VersionCreateInput {
  version: ProjectVersion;
  document: Document;
}

export interface VersionUpdate {
  status?: ProjectStatus;
  targetDate?: string | null;
  androidStatus?: PlatformReleaseStatus;
  iosStatus?: PlatformReleaseStatus;
}

export interface TodayItem {
  id: string;
  kind: "task" | "next_action" | "project_signal";
  projectId: string;
  projectTitle: string;
  text: string;
  dueDate: string | null;
  priority: ProjectPriority | null;
  blocked: boolean;
  rank: number;
  taskId: string | null;
}

export interface ProjectRepository {
  create(input: ProjectCreateInput): Promise<Project>;
  getById(ownerId: string, id: string): Promise<Project | null>;
  list(ownerId: string, options?: ProjectListOptions): Promise<readonly Project[]>;
  update(ownerId: string, id: string, changes: ProjectUpdate, deviceId: string): Promise<Project>;
  versions(ownerId: string, projectId: string): Promise<readonly ProjectVersion[]>;
  createVersion(input: VersionCreateInput): Promise<ProjectVersion>;
  getVersion(ownerId: string, id: string): Promise<ProjectVersion | null>;
  updateVersion(
    ownerId: string,
    id: string,
    changes: VersionUpdate,
    deviceId: string,
  ): Promise<ProjectVersion>;
  tasks(ownerId: string, projectId?: string): Promise<readonly ProjectTask[]>;
  toggleTask(
    ownerId: string,
    taskId: string,
    completed: boolean,
    deviceId: string,
  ): Promise<ProjectTask>;
  blockers(ownerId: string, projectId: string): Promise<readonly ProjectBlocker[]>;
  addBlocker(ownerId: string, blocker: ProjectBlocker, deviceId: string): Promise<ProjectBlocker>;
  resolveBlocker(ownerId: string, id: string, resolvedAt: string, deviceId: string): Promise<void>;
  addInboxItem(ownerId: string, text: string, deviceId: string): Promise<Document>;
  addDecision(ownerId: string, decision: ProjectDecision, deviceId: string): Promise<Document>;
  today(ownerId: string, now: string): Promise<readonly TodayItem[]>;
  exportProject(ownerId: string, projectId: string): Promise<readonly ExportedProjectFile[]>;
}

export interface ExportedProjectFile {
  path: string;
  content: string;
  encoding?: "utf8" | "base64";
  mimeType?: string;
}

export interface NoteRepository {
  create(document: Document): Promise<Document>;
  getById(ownerId: string, id: string, includeDeleted?: boolean): Promise<Document | null>;
  list(ownerId: string, options?: NoteListOptions): Promise<readonly Document[]>;
  updateMarkdown(
    ownerId: string,
    id: string,
    markdown: string,
    deviceId: string,
  ): Promise<Document>;
  rename(ownerId: string, id: string, title: string, deviceId: string): Promise<Document>;
  setPinned(ownerId: string, id: string, pinned: boolean, deviceId: string): Promise<Document>;
  softDelete(ownerId: string, id: string, deviceId: string): Promise<Document>;
  restore(ownerId: string, id: string, deviceId: string): Promise<Document>;
  permanentlyDelete(ownerId: string, id: string): Promise<void>;
  revisions(ownerId: string, id: string): Promise<readonly DocumentRevision[]>;
  restoreRevision(
    ownerId: string,
    id: string,
    revision: number,
    deviceId: string,
  ): Promise<Document>;
  getDraft(ownerId: string, documentId: string): Promise<NoteDraft | null>;
  saveDraft(draft: NoteDraft): Promise<void>;
  clearDraft(ownerId: string, documentId: string): Promise<void>;
}

export interface DeviceRepository {
  getOrCreate(input: Omit<Device, "lastSeenAt">): Promise<Device>;
  bindOwner(id: string, ownerId: string): Promise<void>;
  touch(id: string, lastSeenAt: string): Promise<void>;
}

export type DocumentRepository = Repository<Document>;
