import {
  compareTasks,
  createNextRecurringTask,
  matchesTaskList,
  occurrenceId,
  validateTask,
  type Document,
  type Task,
  type TaskListOptions,
  type TaskOccurrence,
  type TaskRepository,
} from "@stone/domain";
import { extractMarkdownTasks, setMarkdownTaskChecked } from "@stone/markdown";
import type { StoneDatabase } from "./database";
import { enqueueOutbox } from "./sync";

interface TaskRow {
  id: string;
  owner_id: string;
  schema_version: number;
  title: string;
  description: string | null;
  state: string;
  completed_at: string | null;
  due_date: string | null;
  due_time: string | null;
  timezone: string;
  priority: string;
  sort_order: number;
  tags: string;
  project_id: string | null;
  source_document_id: string | null;
  source_block_id: string | null;
  source_fingerprint: string | null;
  parent_task_id: string | null;
  estimated_minutes: number | null;
  recurrence: string | null;
  recurrence_series_id: string | null;
  occurrence_date: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  updated_by_device_id: string;
}

export class SQLiteTaskRepository implements TaskRepository {
  public constructor(private readonly database: StoneDatabase) {}

  public async create(task: Task): Promise<Task> {
    const valid = validateTask(task);
    await this.database.withTransactionAsync(async () => {
      await insertTask(this.database, valid);
      await queueTask(this.database, valid, 0);
    });
    return valid;
  }

  public async getById(ownerId: string, id: string, includeDeleted = false): Promise<Task | null> {
    const row = await this.database.getFirstAsync<TaskRow>(
      `SELECT ${TASK_COLUMNS} FROM tasks WHERE owner_id = ? AND id = ? ${includeDeleted ? "" : "AND deleted_at IS NULL"}`,
      ownerId,
      id,
    );
    return row ? fromRow(row) : null;
  }

  public async list(ownerId: string, options: TaskListOptions = {}): Promise<readonly Task[]> {
    const limit = Math.max(1, Math.min(options.limit ?? 500, 2_000));
    const rows = await this.database.getAllAsync<TaskRow>(
      `SELECT ${TASK_COLUMNS} FROM tasks WHERE owner_id = ? ORDER BY due_date IS NULL, due_date, sort_order, updated_at DESC LIMIT ?`,
      ownerId,
      limit,
    );
    return rows
      .map(fromRow)
      .filter((task) => matchesTaskList(task, options))
      .sort(compareTasks);
  }

  public async save(
    ownerId: string,
    task: Task,
    expectedRevision: number,
    deviceId: string,
  ): Promise<Task> {
    const current = await this.require(ownerId, task.id, true);
    if (current.revision !== expectedRevision) throw new Error("Task revision conflict.");
    const next = validateTask({
      ...task,
      ownerId,
      revision: current.revision + 1,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString(),
      updatedByDeviceId: deviceId,
    });
    await this.database.withTransactionAsync(async () => {
      await updateTask(this.database, next);
      await this.updateMarkdownSource(current, next, deviceId);
      await queueTask(this.database, next, current.revision);
    });
    return next;
  }

  public async complete(
    ownerId: string,
    id: string,
    completedAt: string,
    deviceId: string,
  ): Promise<{ task: Task; nextTask: Task | null }> {
    const current = await this.require(ownerId, id);
    if (current.state === "completed") {
      const candidate = createNextRecurringTask(current, completedAt);
      const existingNext = candidate ? await this.getById(ownerId, candidate.id) : null;
      return { task: current, nextTask: existingNext };
    }
    const completed = validateTask({
      ...current,
      state: "completed",
      completedAt,
      revision: current.revision + 1,
      updatedAt: completedAt,
      updatedByDeviceId: deviceId,
    });
    const nextTask = createNextRecurringTask(current, completedAt);
    await this.database.withTransactionAsync(async () => {
      await updateTask(this.database, completed);
      await this.updateMarkdownSource(current, completed, deviceId);
      await queueTask(this.database, completed, current.revision);
      if (current.recurrence) {
        const seriesId = current.recurrenceSeriesId ?? current.id;
        const scheduledDate = current.occurrenceDate ?? current.dueDate!;
        await this.database.runAsync(
          "INSERT OR IGNORE INTO task_occurrences (id, owner_id, task_id, series_id, scheduled_date, completed_at, task_snapshot) VALUES (?, ?, ?, ?, ?, ?, ?)",
          occurrenceId(seriesId, scheduledDate),
          ownerId,
          current.id,
          seriesId,
          scheduledDate,
          completedAt,
          JSON.stringify(completed),
        );
      }
      if (nextTask) {
        await insertTask(this.database, nextTask, true);
        await queueTask(this.database, nextTask, 0);
      }
    });
    return { task: completed, nextTask };
  }

  public async reopen(ownerId: string, id: string, deviceId: string): Promise<Task> {
    const current = await this.require(ownerId, id);
    if (current.state === "open") return current;
    return this.save(
      ownerId,
      { ...current, state: "open", completedAt: null },
      current.revision,
      deviceId,
    );
  }

  public async softDelete(ownerId: string, id: string, deviceId: string): Promise<Task> {
    const current = await this.require(ownerId, id);
    return this.save(
      ownerId,
      { ...current, deletedAt: new Date().toISOString() },
      current.revision,
      deviceId,
    );
  }

  public async reorder(
    ownerId: string,
    parentTaskId: string | null,
    orderedIds: readonly string[],
    deviceId: string,
  ): Promise<readonly Task[]> {
    const updated: Task[] = [];
    await this.database.withTransactionAsync(async () => {
      for (let index = 0; index < orderedIds.length; index += 1) {
        const current = await this.require(ownerId, orderedIds[index]!);
        if (current.parentTaskId !== parentTaskId) throw new Error("Task parent changed.");
        const next = {
          ...current,
          sortOrder: index,
          revision: current.revision + 1,
          updatedAt: new Date().toISOString(),
          updatedByDeviceId: deviceId,
        };
        await updateTask(this.database, next);
        await queueTask(this.database, next, current.revision);
        updated.push(next);
      }
    });
    return updated;
  }

  public async occurrences(ownerId: string, seriesId: string): Promise<readonly TaskOccurrence[]> {
    const rows = await this.database.getAllAsync<{
      id: string;
      owner_id: string;
      task_id: string;
      series_id: string;
      scheduled_date: string;
      completed_at: string;
      task_snapshot: string;
    }>(
      "SELECT id, owner_id, task_id, series_id, scheduled_date, completed_at, task_snapshot FROM task_occurrences WHERE owner_id = ? AND series_id = ? ORDER BY scheduled_date DESC",
      ownerId,
      seriesId,
    );
    return rows.map((row) => ({
      id: row.id,
      ownerId: row.owner_id,
      taskId: row.task_id,
      seriesId: row.series_id,
      scheduledDate: row.scheduled_date,
      completedAt: row.completed_at,
      taskSnapshot: validateTask(JSON.parse(row.task_snapshot) as Task),
    }));
  }

  private async require(ownerId: string, id: string, includeDeleted = false): Promise<Task> {
    const task = await this.getById(ownerId, id, includeDeleted);
    if (!task) throw new Error("Task not found.");
    return task;
  }

  private async updateMarkdownSource(current: Task, next: Task, deviceId: string): Promise<void> {
    if (!current.sourceDocumentId || current.state === next.state) return;
    const document = await this.database.getFirstAsync<{
      id: string;
      owner_id: string;
      kind: string;
      title: string;
      markdown: string;
      path: string | null;
      project_id: string | null;
      is_pinned: number;
      revision: number;
      created_at: string;
      deleted_at: string | null;
    }>(
      "SELECT id, owner_id, kind, title, markdown, path, project_id, is_pinned, revision, created_at, deleted_at FROM documents WHERE owner_id = ? AND id = ? AND deleted_at IS NULL",
      current.ownerId,
      current.sourceDocumentId,
    );
    if (!document) throw new Error("Task source note is unavailable.");
    const source = extractMarkdownTasks(document.markdown).find((item) =>
      current.sourceBlockId
        ? item.blockId === current.sourceBlockId
        : `md-${stableHash(
            `${current.ownerId}:${current.sourceDocumentId}:${item.fingerprint}`,
          )}` === current.id,
    );
    if (!source) throw new Error("Task source block changed; resolve the note conflict.");
    const markdown = setMarkdownTaskChecked(document.markdown, source, next.state === "completed");
    const revision = document.revision + 1;
    const updatedAt = next.updatedAt;
    await this.database.runAsync(
      "UPDATE documents SET markdown = ?, revision = ?, updated_at = ?, updated_by_device_id = ? WHERE owner_id = ? AND id = ?",
      markdown,
      revision,
      updatedAt,
      deviceId,
      current.ownerId,
      current.sourceDocumentId,
    );
    await this.database.runAsync(
      "INSERT INTO document_revisions (id, document_id, revision, markdown, created_at) VALUES (?, ?, ?, ?, ?)",
      `${document.id}:${revision}`,
      document.id,
      revision,
      markdown,
      updatedAt,
    );
    await this.database.runAsync("DELETE FROM documents_fts WHERE document_id = ?", document.id);
    await this.database.runAsync(
      "INSERT INTO documents_fts (document_id, owner_id, title, markdown) VALUES (?, ?, ?, ?)",
      document.id,
      document.owner_id,
      document.title,
      markdown,
    );
    await enqueueOutbox(this.database, {
      ownerId: document.owner_id,
      entityType: "document",
      entityId: document.id,
      operation: "upsert",
      baseRevision: document.revision,
      revision,
      payloadVersion: 1,
      payload: {
        id: document.id,
        ownerId: document.owner_id,
        kind: document.kind,
        title: document.title,
        markdown,
        path: document.path,
        projectId: document.project_id,
        isPinned: document.is_pinned === 1,
        revision,
        createdAt: document.created_at,
        updatedAt,
        deletedAt: document.deleted_at,
        updatedByDeviceId: deviceId,
      },
      createdAt: updatedAt,
      idempotencyKey: `${deviceId}:document:${document.id}:${revision}`,
    });
  }
}

export async function reindexMarkdownTasks(
  database: StoneDatabase,
  document: Document,
): Promise<void> {
  const extracted = extractMarkdownTasks(document.markdown);
  const activeIds = new Set<string>();
  for (const source of extracted) {
    const identity = source.blockId ?? source.fingerprint;
    const id = `md-${stableHash(`${document.ownerId}:${document.id}:${identity}`)}`;
    activeIds.add(id);
    const existing = await database.getFirstAsync<TaskRow>(
      `SELECT ${TASK_COLUMNS} FROM tasks WHERE owner_id = ? AND id = ?`,
      document.ownerId,
      id,
    );
    const state = source.checked ? "completed" : "open";
    const task: Task = existing
      ? {
          ...fromRow(existing),
          title: source.text,
          state,
          completedAt: state === "completed" ? (existing.completed_at ?? document.updatedAt) : null,
          sourceBlockId: source.blockId,
          sortOrder: source.line,
          revision: existing.revision + 1,
          updatedAt: document.updatedAt,
          deletedAt: document.deletedAt,
          updatedByDeviceId: document.updatedByDeviceId,
        }
      : {
          schemaVersion: 1,
          id,
          ownerId: document.ownerId,
          title: source.text,
          description: null,
          state,
          completedAt: state === "completed" ? document.updatedAt : null,
          dueDate: null,
          dueTime: null,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
          priority: "none",
          sortOrder: source.line,
          tags: [],
          projectId: document.projectId,
          sourceDocumentId: document.id,
          sourceBlockId: source.blockId,
          parentTaskId: null,
          estimatedMinutes: null,
          recurrence: null,
          recurrenceSeriesId: null,
          occurrenceDate: null,
          revision: 1,
          createdAt: document.createdAt,
          updatedAt: document.updatedAt,
          deletedAt: document.deletedAt,
          updatedByDeviceId: document.updatedByDeviceId,
        };
    if (
      existing &&
      existing.title === task.title &&
      existing.state === task.state &&
      existing.source_block_id === task.sourceBlockId &&
      existing.project_id === task.projectId &&
      existing.sort_order === task.sortOrder &&
      existing.deleted_at === task.deletedAt
    )
      continue;
    validateTask(task);
    if (existing) await updateTask(database, task);
    else await insertTask(database, task);
    await queueTask(database, task, existing?.revision ?? 0);
  }
  const existing = await database.getAllAsync<TaskRow>(
    `SELECT ${TASK_COLUMNS} FROM tasks WHERE owner_id = ? AND source_document_id = ? AND deleted_at IS NULL`,
    document.ownerId,
    document.id,
  );
  for (const row of existing) {
    if (activeIds.has(row.id)) continue;
    const task = {
      ...fromRow(row),
      deletedAt: document.updatedAt,
      revision: row.revision + 1,
      updatedAt: document.updatedAt,
      updatedByDeviceId: document.updatedByDeviceId,
    };
    await updateTask(database, task);
    await queueTask(database, task, row.revision);
  }
}

const TASK_COLUMNS =
  "id, owner_id, schema_version, title, description, state, completed_at, due_date, due_time, timezone, priority, sort_order, tags, project_id, source_document_id, source_block_id, source_fingerprint, parent_task_id, estimated_minutes, recurrence, recurrence_series_id, occurrence_date, revision, created_at, updated_at, deleted_at, updated_by_device_id";

function fromRow(row: TaskRow): Task {
  return validateTask({
    schemaVersion: 1,
    id: row.id,
    ownerId: row.owner_id,
    title: row.title,
    description: row.description,
    state: row.state as Task["state"],
    completedAt: row.completed_at,
    dueDate: row.due_date,
    dueTime: row.due_time,
    timezone: row.timezone,
    priority: row.priority as Task["priority"],
    sortOrder: row.sort_order,
    tags: JSON.parse(row.tags) as string[],
    projectId: row.project_id,
    sourceDocumentId: row.source_document_id,
    sourceBlockId: row.source_block_id,
    parentTaskId: row.parent_task_id,
    estimatedMinutes: row.estimated_minutes,
    recurrence: row.recurrence ? (JSON.parse(row.recurrence) as Task["recurrence"]) : null,
    recurrenceSeriesId: row.recurrence_series_id,
    occurrenceDate: row.occurrence_date,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    updatedByDeviceId: row.updated_by_device_id,
  });
}

async function insertTask(database: StoneDatabase, task: Task, ignore = false): Promise<void> {
  await database.runAsync(
    `${ignore ? "INSERT OR IGNORE" : "INSERT"} INTO tasks (${TASK_COLUMNS}) VALUES (${Array.from({ length: 27 }, () => "?").join(", ")})`,
    ...toValues(task),
  );
}

async function updateTask(database: StoneDatabase, task: Task): Promise<void> {
  await database.runAsync(
    "UPDATE tasks SET schema_version=?, title=?, description=?, state=?, completed_at=?, due_date=?, due_time=?, timezone=?, priority=?, sort_order=?, tags=?, project_id=?, source_document_id=?, source_block_id=?, source_fingerprint=?, parent_task_id=?, estimated_minutes=?, recurrence=?, recurrence_series_id=?, occurrence_date=?, revision=?, created_at=?, updated_at=?, deleted_at=?, updated_by_device_id=? WHERE owner_id=? AND id=?",
    task.schemaVersion,
    task.title,
    task.description,
    task.state,
    task.completedAt,
    task.dueDate,
    task.dueTime,
    task.timezone,
    task.priority,
    task.sortOrder,
    JSON.stringify(task.tags),
    task.projectId,
    task.sourceDocumentId,
    task.sourceBlockId,
    task.sourceBlockId ? null : task.id,
    task.parentTaskId,
    task.estimatedMinutes,
    task.recurrence ? JSON.stringify(task.recurrence) : null,
    task.recurrenceSeriesId,
    task.occurrenceDate,
    task.revision,
    task.createdAt,
    task.updatedAt,
    task.deletedAt,
    task.updatedByDeviceId,
    task.ownerId,
    task.id,
  );
}

function toValues(task: Task): readonly (string | number | null)[] {
  return [
    task.id,
    task.ownerId,
    task.schemaVersion,
    task.title,
    task.description,
    task.state,
    task.completedAt,
    task.dueDate,
    task.dueTime,
    task.timezone,
    task.priority,
    task.sortOrder,
    JSON.stringify(task.tags),
    task.projectId,
    task.sourceDocumentId,
    task.sourceBlockId,
    task.sourceBlockId ? null : task.id,
    task.parentTaskId,
    task.estimatedMinutes,
    task.recurrence ? JSON.stringify(task.recurrence) : null,
    task.recurrenceSeriesId,
    task.occurrenceDate,
    task.revision,
    task.createdAt,
    task.updatedAt,
    task.deletedAt,
    task.updatedByDeviceId,
  ];
}

async function queueTask(database: StoneDatabase, task: Task, baseRevision: number): Promise<void> {
  await enqueueOutbox(database, {
    ownerId: task.ownerId,
    entityType: "task",
    entityId: task.id,
    operation: task.deletedAt ? "delete" : "upsert",
    baseRevision,
    revision: task.revision,
    payloadVersion: 1,
    payload: task as unknown as Record<string, unknown>,
    createdAt: task.updatedAt,
    idempotencyKey: `${task.updatedByDeviceId}:task:${task.id}:${task.revision}`,
  });
}

function stableHash(value: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `${(first >>> 0).toString(36)}${(second >>> 0).toString(36)}`;
}
