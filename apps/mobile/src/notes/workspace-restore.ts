import {
  validateTask,
  type CalendarItem,
  type Document,
  type DocumentKind,
  type Drawing,
  type ExportedProjectFile,
  type FocusGoal,
  type FocusSession,
  type PlatformReleaseStatus,
  type Project,
  type ProjectPlatform,
  type ProjectPriority,
  type ProjectStatus,
  type ProjectVersion,
  type Task,
} from "@stone/domain";
import { parseProjectFrontmatter, parseVersionFrontmatter } from "@stone/markdown";
import {
  restoreCalendarWorkspaceFile,
  restoreFocusWorkspaceFile,
  type CalendarRestoreSummary,
} from "./workspace-bundle";

/** Everything a full restore writes through; the app passes its repositories. */
export interface WorkspaceRestoreTarget {
  ownerId: string;
  deviceId: string;
  now: string;
  getDocument(id: string): Promise<Document | null>;
  createDocument(document: Document): Promise<unknown>;
  getProject(id: string): Promise<Project | null>;
  createProject(project: Project, documents: readonly Document[]): Promise<unknown>;
  getVersion(id: string): Promise<ProjectVersion | null>;
  createVersion(version: ProjectVersion, document: Document): Promise<unknown>;
  getTask(id: string): Promise<Task | null>;
  createTask(task: Task): Promise<unknown>;
  getDrawing(id: string): Promise<Drawing | null>;
  /** Writes the PNG preview somewhere durable and returns its path. */
  writeDrawingPreview(id: string, base64: string): Promise<string>;
  createDrawing(drawing: Drawing, source: string, previewPath: string): Promise<unknown>;
  calendar: {
    getById(ownerId: string, id: string, includeDeleted?: boolean): Promise<CalendarItem | null>;
    create(item: CalendarItem): Promise<CalendarItem>;
  };
  focus: {
    getById(ownerId: string, id: string, includeDeleted?: boolean): Promise<FocusSession | null>;
    create(session: FocusSession): Promise<FocusSession>;
    getGoal(ownerId: string): Promise<FocusGoal | null>;
    saveGoal(goal: FocusGoal, expectedRevision: number | null): Promise<FocusGoal>;
  };
  /** Ids that exist locally (after the steps above), for keeping calendar/focus links. */
  relationshipIds(): Promise<{
    taskIds: ReadonlySet<string>;
    projectIds: ReadonlySet<string>;
    documentIds: ReadonlySet<string>;
    calendarItemIds: ReadonlySet<string>;
  }>;
}

export interface RestoreCount {
  created: number;
  duplicates: number;
}

export interface WorkspaceRestoreSummary {
  projects: RestoreCount;
  notes: RestoreCount;
  versions: RestoreCount;
  tasks: RestoreCount;
  drawings: RestoreCount;
  calendar: CalendarRestoreSummary | null;
  focus: CalendarRestoreSummary | null;
  /** Human-readable reasons for entries that could not be restored. */
  skipped: readonly string[];
}

interface ManifestDocument {
  id: string;
  kind: DocumentKind;
  path: string;
  projectId: string | null;
  title: string | null;
  isPinned: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

interface ManifestDrawing {
  id: string;
  source: string;
  preview: string;
  documentId: string | null;
  title: string | null;
}

const DOCUMENT_KINDS: readonly DocumentKind[] = [
  "note",
  "project",
  "version",
  "decision_log",
  "inbox",
  "release_checklist",
];
const PROJECT_STATUSES: readonly ProjectStatus[] = [
  "idea",
  "planning",
  "development",
  "testing",
  "store_process",
  "live",
  "update_needed",
  "maintenance",
  "paused",
  "archived",
];
const PRIORITIES: readonly ProjectPriority[] = ["low", "medium", "high", "critical"];
const PLATFORMS: readonly ProjectPlatform[] = ["android", "ios", "windows", "web", "other"];
const RELEASE_STATUSES: readonly PlatformReleaseStatus[] = [
  "not_planned",
  "preparing",
  "internal_testing",
  "external_testing",
  "review",
  "live",
  "paused",
  "rejected",
];

/**
 * Restores a full `.stone-workspace.json` export. It only adds what is missing locally (existing
 * ids are counted as duplicates and never overwritten), re-owns everything to the signed-in
 * account and starts each entity at revision 1, which is what the owner-scoped Firestore rules
 * accept for a create. That makes it safe for moving to a new account or project, and idempotent
 * when run twice.
 */
export async function restoreWorkspace(
  files: readonly ExportedProjectFile[],
  target: WorkspaceRestoreTarget,
): Promise<WorkspaceRestoreSummary> {
  const byPath = new Map(files.map((file) => [file.path, file]));
  const manifestFile = byPath.get("manifest.json");
  if (!manifestFile) throw new Error("Workspace export has no manifest.json.");
  const manifest = parseManifest(manifestFile.content);
  const skipped: string[] = [];
  const summary: WorkspaceRestoreSummary = {
    projects: { created: 0, duplicates: 0 },
    notes: { created: 0, duplicates: 0 },
    versions: { created: 0, duplicates: 0 },
    tasks: { created: 0, duplicates: 0 },
    drawings: { created: 0, duplicates: 0 },
    calendar: null,
    focus: null,
    skipped,
  };

  const documents: Document[] = [];
  for (const entry of manifest.documents) {
    const file = byPath.get(entry.path);
    if (!file || file.encoding === "base64") {
      skipped.push(`${entry.path}: file missing from export`);
      continue;
    }
    documents.push(toDocument(entry, file.content, target));
  }

  // Projects first: their canonical document carries the metadata in frontmatter.
  const projectDocuments = new Map<string, Document[]>();
  for (const document of documents)
    if (document.projectId && document.kind !== "version" && document.kind !== "note")
      projectDocuments.set(document.projectId, [
        ...(projectDocuments.get(document.projectId) ?? []),
        document,
      ]);
  const restoredDocumentIds = new Set<string>();
  const projects = new Map<string, Project>();
  for (const [projectId, group] of projectDocuments) {
    const canonical = group.find((document) => document.kind === "project");
    if (!canonical) {
      skipped.push(`project ${projectId}: canonical Project.md missing`);
      continue;
    }
    const existing = await target.getProject(projectId);
    if (existing) {
      projects.set(projectId, existing);
      summary.projects.duplicates += 1;
      continue;
    }
    let project: Project;
    try {
      project = projectFromDocument(projectId, canonical, target);
    } catch (error) {
      skipped.push(`${canonical.path ?? canonical.id}: ${message(error)}`);
      continue;
    }
    const fresh: Document[] = [];
    for (const document of group) {
      if (await target.getDocument(document.id)) summary.notes.duplicates += 1;
      else fresh.push(document);
    }
    await target.createProject(project, fresh);
    for (const document of fresh) restoredDocumentIds.add(document.id);
    projects.set(projectId, project);
    summary.projects.created += 1;
  }

  for (const document of documents) {
    if (document.kind !== "version") continue;
    const project = document.projectId ? projects.get(document.projectId) : undefined;
    if (!project) {
      skipped.push(`${document.path ?? document.id}: version without a restored project`);
      continue;
    }
    let version: ProjectVersion;
    try {
      version = versionFromDocument(project, document, target);
    } catch (error) {
      skipped.push(`${document.path ?? document.id}: ${message(error)}`);
      continue;
    }
    if ((await target.getVersion(version.id)) || (await target.getDocument(document.id))) {
      summary.versions.duplicates += 1;
      continue;
    }
    await target.createVersion(version, document);
    restoredDocumentIds.add(document.id);
    summary.versions.created += 1;
  }

  for (const document of documents) {
    if (document.kind === "version" || restoredDocumentIds.has(document.id)) continue;
    if (document.projectId && document.kind !== "note") continue; // handled with its project
    if (await target.getDocument(document.id)) {
      summary.notes.duplicates += 1;
      continue;
    }
    // A note may point at a project that was not part of this export; keep the note, drop the link.
    const projectId =
      document.projectId &&
      (projects.has(document.projectId) || (await target.getProject(document.projectId)))
        ? document.projectId
        : null;
    await target.createDocument({ ...document, projectId });
    restoredDocumentIds.add(document.id);
    summary.notes.created += 1;
  }

  const tasksFile = byPath.get("tasks.json");
  if (tasksFile) {
    for (const task of parseTasks(tasksFile.content, target, skipped)) {
      if (await target.getTask(task.id)) {
        summary.tasks.duplicates += 1;
        continue;
      }
      await target.createTask(task);
      summary.tasks.created += 1;
    }
  }

  for (const drawing of manifest.drawings) {
    const source = byPath.get(drawing.source);
    const preview = byPath.get(drawing.preview);
    if (!source || source.encoding === "base64") {
      skipped.push(`${drawing.source}: drawing source missing from export`);
      continue;
    }
    if (await target.getDrawing(drawing.id)) {
      summary.drawings.duplicates += 1;
      continue;
    }
    const previewPath =
      preview?.encoding === "base64"
        ? await target.writeDrawingPreview(drawing.id, preview.content)
        : "";
    const documentId =
      drawing.documentId && (await target.getDocument(drawing.documentId))
        ? drawing.documentId
        : null;
    await target.createDrawing(
      {
        id: drawing.id,
        ownerId: target.ownerId,
        documentId,
        title: drawing.title ?? "Drawing",
        sourcePath: "",
        previewPath,
        sourceSha256: "",
        previewSha256: "",
        sourceSize: 0,
        previewSize: 0,
        revision: 1,
        createdAt: target.now,
        updatedAt: target.now,
        deletedAt: null,
        updatedByDeviceId: target.deviceId,
      },
      source.content,
      previewPath,
    );
    summary.drawings.created += 1;
  }

  const calendarFile = byPath.get("calendar.json");
  if (calendarFile)
    summary.calendar = await restoreCalendarWorkspaceFile(
      rebaseCollection(calendarFile.content, "items", target),
      target.ownerId,
      target.calendar,
      await target.relationshipIds(),
    );

  const focusFile = byPath.get("focus.json");
  if (focusFile)
    summary.focus = await restoreFocusWorkspaceFile(
      rebaseCollection(focusFile.content, "sessions", target, "goal"),
      target.ownerId,
      target.focus,
      await target.relationshipIds(),
    );

  return summary;
}

function parseManifest(content: string): {
  documents: readonly ManifestDocument[];
  drawings: readonly ManifestDrawing[];
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Workspace manifest is not valid JSON.");
  }
  if (!isRecord(parsed) || parsed.schema !== 2 || !Array.isArray(parsed.documents))
    throw new Error("Workspace manifest schema is not supported.");
  const documents = parsed.documents.map((value): ManifestDocument => {
    if (
      !isRecord(value) ||
      typeof value.id !== "string" ||
      typeof value.path !== "string" ||
      !DOCUMENT_KINDS.includes(value.kind as DocumentKind)
    )
      throw new Error("Workspace manifest contains an invalid document.");
    return {
      id: value.id,
      kind: value.kind as DocumentKind,
      path: value.path,
      projectId: typeof value.projectId === "string" ? value.projectId : null,
      title: typeof value.title === "string" ? value.title : null,
      isPinned: value.isPinned === true,
      createdAt: typeof value.createdAt === "string" ? value.createdAt : null,
      updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : null,
    };
  });
  const drawings = (Array.isArray(parsed.drawings) ? parsed.drawings : []).map(
    (value): ManifestDrawing => {
      if (
        !isRecord(value) ||
        typeof value.id !== "string" ||
        typeof value.source !== "string" ||
        typeof value.preview !== "string"
      )
        throw new Error("Workspace manifest contains an invalid drawing.");
      return {
        id: value.id,
        source: value.source,
        preview: value.preview,
        documentId: typeof value.documentId === "string" ? value.documentId : null,
        title: typeof value.title === "string" ? value.title : null,
      };
    },
  );
  return { documents, drawings };
}

function toDocument(
  entry: ManifestDocument,
  markdown: string,
  target: WorkspaceRestoreTarget,
): Document {
  return {
    id: entry.id,
    ownerId: target.ownerId,
    kind: entry.kind,
    title: entry.title ?? titleFromExport(entry, markdown),
    markdown,
    path: entry.path,
    projectId: entry.projectId,
    isPinned: entry.isPinned,
    revision: 1,
    createdAt: entry.createdAt ?? entry.updatedAt ?? target.now,
    updatedAt: entry.updatedAt ?? target.now,
    deletedAt: null,
    updatedByDeviceId: target.deviceId,
  };
}

/** Older exports (before titles were in the manifest): first heading, else the file name. */
export function titleFromExport(
  entry: Pick<ManifestDocument, "id" | "path">,
  markdown: string,
): string {
  const heading = /^#\s+(.+)$/mu.exec(markdown.replace(/^---[\s\S]*?\n---\n/u, ""))?.[1]?.trim();
  if (heading) return heading.slice(0, 512);
  const file =
    entry.path
      .split("/")
      .at(-1)
      ?.replace(/\.(?:md|markdown)$/iu, "") ?? "";
  const withoutId = file.replace(new RegExp(`-${entry.id.slice(0, 8)}$`, "u"), "");
  return withoutId.replaceAll("-", " ").trim() || "Untitled";
}

function projectFromDocument(
  projectId: string,
  document: Document,
  target: WorkspaceRestoreTarget,
): Project {
  const frontmatter = parseProjectFrontmatter(document.markdown);
  if (frontmatter.id !== projectId) throw new Error("project frontmatter id does not match");
  const slug = document.path?.split("/")[1] ?? projectId;
  return {
    id: projectId,
    ownerId: target.ownerId,
    canonicalDocumentId: document.id,
    title: document.title,
    slug,
    status: oneOf(frontmatter.status, PROJECT_STATUSES, "planning"),
    priority: oneOf(frontmatter.priority, PRIORITIES, "medium"),
    tags: stringArray(frontmatter.tags),
    targetDate: nullableString(frontmatter.targetDate),
    currentVersion: nullableString(frontmatter.currentVersion),
    nextVersion: nullableString(frontmatter.nextVersion),
    nextAction: nullableString(frontmatter.nextAction),
    repositoryUrl: nullableString(frontmatter.repositoryUrl),
    platforms: stringArray(frontmatter.platforms).filter((value): value is ProjectPlatform =>
      (PLATFORMS as readonly string[]).includes(value),
    ),
    health: "good",
    revision: 1,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    deletedAt: null,
    updatedByDeviceId: target.deviceId,
  };
}

function versionFromDocument(
  project: Project,
  document: Document,
  target: WorkspaceRestoreTarget,
): ProjectVersion {
  const frontmatter = parseVersionFrontmatter(document.markdown);
  if (frontmatter.projectId !== project.id) throw new Error("version belongs to another project");
  return {
    id: frontmatter.id,
    ownerId: target.ownerId,
    projectId: project.id,
    canonicalDocumentId: document.id,
    version: String(frontmatter.version),
    status: oneOf(frontmatter.status, PROJECT_STATUSES, "development"),
    targetDate: nullableString(frontmatter.targetDate),
    androidStatus: oneOf(frontmatter.platforms?.android, RELEASE_STATUSES, "not_planned"),
    iosStatus: oneOf(frontmatter.platforms?.ios, RELEASE_STATUSES, "not_planned"),
    completedTasks: 0,
    totalTasks: 0,
    revision: 1,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    deletedAt: null,
    updatedByDeviceId: target.deviceId,
  };
}

/** `tasks.json` holds raw SQLite rows (snake_case, JSON-encoded tags/recurrence). */
export function parseTasks(
  content: string,
  target: Pick<WorkspaceRestoreTarget, "ownerId" | "deviceId">,
  skipped: string[],
): readonly Task[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Task workspace data is not valid JSON.");
  }
  if (!isRecord(parsed) || parsed.schema !== 1 || !Array.isArray(parsed.tasks))
    throw new Error("Task workspace schema is not supported.");
  const tasks: Task[] = [];
  for (const row of parsed.tasks) {
    if (!isRecord(row) || typeof row.id !== "string") continue;
    if (row.deleted_at) continue; // soft-deleted tasks are not resurrected
    try {
      tasks.push(
        validateTask({
          schemaVersion: 1,
          id: row.id,
          ownerId: target.ownerId,
          title: typeof row.title === "string" ? row.title : "",
          description: nullableString(row.description),
          state: row.state as Task["state"],
          completedAt: nullableString(row.completed_at),
          dueDate: nullableString(row.due_date),
          dueTime: nullableString(row.due_time),
          timezone: typeof row.timezone === "string" ? row.timezone : "UTC",
          priority: row.priority as Task["priority"],
          sortOrder: Number(row.sort_order ?? 0),
          tags: jsonArray(row.tags),
          projectId: nullableString(row.project_id),
          sourceDocumentId: nullableString(row.source_document_id),
          sourceBlockId: nullableString(row.source_block_id),
          parentTaskId: nullableString(row.parent_task_id),
          estimatedMinutes: row.estimated_minutes == null ? null : Number(row.estimated_minutes),
          recurrence:
            typeof row.recurrence === "string"
              ? (JSON.parse(row.recurrence) as Task["recurrence"])
              : null,
          recurrenceSeriesId: nullableString(row.recurrence_series_id),
          occurrenceDate: nullableString(row.occurrence_date),
          revision: 1,
          createdAt: String(row.created_at),
          updatedAt: String(row.updated_at),
          deletedAt: null,
          updatedByDeviceId: target.deviceId,
        }),
      );
    } catch (error) {
      skipped.push(`task ${row.id}: ${message(error)}`);
    }
  }
  return tasks;
}

/** Re-owns calendar/focus records and resets them to revision 1 before the existing restorers run. */
function rebaseCollection(
  content: string,
  key: "items" | "sessions",
  target: WorkspaceRestoreTarget,
  goalKey?: "goal",
): string {
  const parsed = JSON.parse(content) as Record<string, unknown>;
  const rebase = (value: unknown) =>
    isRecord(value)
      ? {
          ...value,
          ownerId: target.ownerId,
          revision: 1,
          deletedAt: null,
          updatedByDeviceId: target.deviceId,
        }
      : value;
  const list = Array.isArray(parsed[key]) ? (parsed[key] as unknown[]) : [];
  const next: Record<string, unknown> = {
    ...parsed,
    // Deleted records stay deleted, and an in-flight timer from another device is not resumed.
    [key]: list
      .filter(
        (value) =>
          !isRecord(value) ||
          (!value.deletedAt && value.status !== "running" && value.status !== "paused"),
      )
      .map(rebase),
  };
  if (goalKey && parsed[goalKey]) next[goalKey] = rebase(parsed[goalKey]);
  return JSON.stringify(next);
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly unknown[]).includes(value) ? (value as T) : fallback;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function jsonArray(value: unknown): string[] {
  if (Array.isArray(value)) return stringArray(value);
  if (typeof value !== "string") return [];
  try {
    return stringArray(JSON.parse(value));
  } catch {
    return [];
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
