import {
  validateCalendarItem,
  validateFocusGoal,
  validateFocusSession,
  type CalendarItem,
  type ExportedProjectFile,
  type FocusGoal,
  type FocusSession,
} from "@stone/domain";

interface WorkspaceBundle {
  schema: 1 | 2 | 3;
  format: "stone-workspace";
  files: readonly WorkspaceBundleFile[];
}

interface WorkspaceBundleFile {
  path: string;
  content: string;
  encoding: "utf8" | "base64";
  mimeType: string;
}

export function serializeWorkspaceBundle(files: readonly ExportedProjectFile[]): string {
  const seen = new Set<string>();
  const normalized = files.map((file) => {
    const path = validateRelativePath(file.path);
    if (seen.has(path)) throw new Error(`Workspace export contains a duplicate path: ${path}`);
    seen.add(path);
    const encoding = file.encoding ?? "utf8";
    if (encoding === "base64" && !isBase64(file.content)) {
      throw new Error(`Workspace export contains invalid base64 data: ${path}`);
    }
    return {
      path,
      content: file.content,
      encoding,
      mimeType: file.mimeType ?? (path.endsWith(".md") ? "text/markdown" : "text/plain"),
    };
  });
  const bundle: WorkspaceBundle = { schema: 3, format: "stone-workspace", files: normalized };
  return `${JSON.stringify(bundle, null, 2)}\n`;
}

export function parseWorkspaceBundle(source: string): readonly ExportedProjectFile[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error("Workspace export is not valid JSON.");
  }
  if (
    !isRecord(parsed) ||
    (parsed.schema !== 1 && parsed.schema !== 2 && parsed.schema !== 3) ||
    parsed.format !== "stone-workspace"
  ) {
    throw new Error("Workspace export schema is not supported.");
  }
  if (!Array.isArray(parsed.files)) throw new Error("Workspace export files are missing.");
  const seen = new Set<string>();
  return parsed.files.map((value) => {
    if (
      !isRecord(value) ||
      typeof value.path !== "string" ||
      typeof value.content !== "string" ||
      (value.encoding !== "utf8" && value.encoding !== "base64") ||
      typeof value.mimeType !== "string"
    ) {
      throw new Error("Workspace export contains an invalid file entry.");
    }
    const path = validateRelativePath(value.path);
    if (seen.has(path)) throw new Error(`Workspace export contains a duplicate path: ${path}`);
    seen.add(path);
    if (value.encoding === "base64" && !isBase64(value.content)) {
      throw new Error(`Workspace export contains invalid base64 data: ${path}`);
    }
    return {
      path,
      content: value.content,
      encoding: value.encoding,
      mimeType: value.mimeType,
    };
  });
}

export function parseCalendarWorkspaceFile(
  source: string,
  ownerId: string,
): readonly CalendarItem[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error("Calendar workspace data is not valid JSON.");
  }
  if (!isRecord(parsed) || parsed.schema !== 1 || !Array.isArray(parsed.items))
    throw new Error("Calendar workspace schema is not supported.");
  if (parsed.items.length > 10_000) throw new Error("Calendar workspace contains too many items.");
  const ids = new Set<string>();
  return parsed.items.map((value) => {
    if (!isRecord(value) || value.ownerId !== ownerId)
      throw new Error("Calendar workspace contains a foreign or invalid owner.");
    const item = validateCalendarItem(value as unknown as CalendarItem);
    if (ids.has(item.id)) throw new Error("Calendar workspace contains duplicate item IDs.");
    ids.add(item.id);
    return item;
  });
}

export interface CalendarRestoreRepository {
  getById(ownerId: string, id: string, includeDeleted?: boolean): Promise<CalendarItem | null>;
  create(item: CalendarItem): Promise<CalendarItem>;
}

export interface CalendarRestoreRelationships {
  taskIds: ReadonlySet<string>;
  projectIds: ReadonlySet<string>;
  documentIds: ReadonlySet<string>;
}

export interface CalendarRestoreSummary {
  created: number;
  duplicates: number;
  detachedRelationships: number;
}

export async function restoreCalendarWorkspaceFile(
  source: string,
  ownerId: string,
  repository: CalendarRestoreRepository,
  relationships: CalendarRestoreRelationships,
): Promise<CalendarRestoreSummary> {
  const items = parseCalendarWorkspaceFile(source, ownerId);
  let created = 0;
  let duplicates = 0;
  let detachedRelationships = 0;
  for (const item of items) {
    if (await repository.getById(ownerId, item.id, true)) {
      duplicates += 1;
      continue;
    }
    const next = {
      ...item,
      taskId: retainedRelationship(item.taskId, relationships.taskIds),
      projectId: retainedRelationship(item.projectId, relationships.projectIds),
      sourceDocumentId: retainedRelationship(item.sourceDocumentId, relationships.documentIds),
    };
    detachedRelationships +=
      Number(next.taskId !== item.taskId) +
      Number(next.projectId !== item.projectId) +
      Number(next.sourceDocumentId !== item.sourceDocumentId);
    await repository.create(next);
    created += 1;
  }
  return { created, duplicates, detachedRelationships };
}

export interface FocusWorkspaceData {
  sessions: readonly FocusSession[];
  goal: FocusGoal | null;
}

export function parseFocusWorkspaceFile(source: string, ownerId: string): FocusWorkspaceData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error("Focus workspace data is not valid JSON.");
  }
  if (
    !isRecord(parsed) ||
    parsed.schema !== 1 ||
    !Array.isArray(parsed.sessions) ||
    parsed.sessions.length > 50_000
  )
    throw new Error("Focus workspace schema is not supported.");
  const ids = new Set<string>();
  const sessions = parsed.sessions.map((value) => {
    if (!isRecord(value) || value.ownerId !== ownerId)
      throw new Error("Focus workspace contains a foreign or invalid owner.");
    const session = validateFocusSession(value as unknown as FocusSession);
    if (ids.has(session.id)) throw new Error("Focus workspace contains duplicate session IDs.");
    ids.add(session.id);
    return session;
  });
  const goal =
    parsed.goal === null
      ? null
      : isRecord(parsed.goal) && parsed.goal.ownerId === ownerId
        ? validateFocusGoal(parsed.goal as unknown as FocusGoal)
        : invalidFocusGoal();
  return { sessions, goal };
}

export interface FocusRestoreRepository {
  getById(ownerId: string, id: string, includeDeleted?: boolean): Promise<FocusSession | null>;
  create(session: FocusSession): Promise<FocusSession>;
  getGoal(ownerId: string): Promise<FocusGoal | null>;
  saveGoal(goal: FocusGoal, expectedRevision: number | null): Promise<FocusGoal>;
}

export interface FocusRestoreRelationships {
  taskIds: ReadonlySet<string>;
  projectIds: ReadonlySet<string>;
  documentIds: ReadonlySet<string>;
  calendarItemIds: ReadonlySet<string>;
}

export async function restoreFocusWorkspaceFile(
  source: string,
  ownerId: string,
  repository: FocusRestoreRepository,
  relationships: FocusRestoreRelationships,
): Promise<CalendarRestoreSummary> {
  const data = parseFocusWorkspaceFile(source, ownerId);
  let created = 0;
  let duplicates = 0;
  let detachedRelationships = 0;
  for (const session of data.sessions) {
    if (await repository.getById(ownerId, session.id, true)) {
      duplicates += 1;
      continue;
    }
    const next = {
      ...session,
      taskId: retainedRelationship(session.taskId, relationships.taskIds),
      projectId: retainedRelationship(session.projectId, relationships.projectIds),
      sourceDocumentId: retainedRelationship(session.sourceDocumentId, relationships.documentIds),
      calendarItemId: retainedRelationship(session.calendarItemId, relationships.calendarItemIds),
    };
    detachedRelationships +=
      Number(next.taskId !== session.taskId) +
      Number(next.projectId !== session.projectId) +
      Number(next.sourceDocumentId !== session.sourceDocumentId) +
      Number(next.calendarItemId !== session.calendarItemId);
    await repository.create(next);
    created += 1;
  }
  if (data.goal && !(await repository.getGoal(ownerId))) {
    await repository.saveGoal(data.goal, null);
  }
  return { created, duplicates, detachedRelationships };
}

function retainedRelationship(value: string | null, existing: ReadonlySet<string>): string | null {
  return value && existing.has(value) ? value : null;
}

function validateRelativePath(value: string): string {
  const path = value.replaceAll("\\", "/").trim();
  if (
    !path ||
    path.startsWith("/") ||
    /^[A-Za-z]:/u.test(path) ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error(`Workspace export contains an unsafe path: ${value}`);
  }
  return path;
}

function isBase64(value: string): boolean {
  return (
    value.length % 4 === 0 &&
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidFocusGoal(): never {
  throw new Error("Focus workspace goal is invalid.");
}
