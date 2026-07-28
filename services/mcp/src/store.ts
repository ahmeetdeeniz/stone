/* eslint-disable @typescript-eslint/require-await */
import { createHash } from "node:crypto";
import { getFirestore, type Firestore, type Query } from "firebase-admin/firestore";
import { CursorCodec } from "./cursor.js";
import {
  McpRevisionConflictError,
  type AuditEntry,
  type CalendarRecord,
  type CalendarWriteInput,
  type DocumentRecord,
  type DocumentWriteInput,
  type ListDocumentsOptions,
  type ListCalendarOptions,
  type ListProjectsOptions,
  type ListVersionsOptions,
  type ListTasksOptions,
  type Page,
  type ProjectRecord,
  type ProjectWriteInput,
  type StoneStore,
  type TaskRecord,
  type TaskWriteInput,
  type StoredIdempotencyResult,
  type VersionRecord,
  type VersionWriteInput,
  type WriteResult,
} from "./contracts.js";

const MAX_QUERY_PAGE = 100;

export class FirestoreStoneStore implements StoneStore {
  public constructor(
    private readonly database: Firestore = getFirestore(),
    private readonly cursors = new CursorCodec(
      process.env.MCP_CURSOR_SECRET ?? "configuration-required",
    ),
  ) {}

  public async getDocument(ownerId: string, id: string): Promise<DocumentRecord | null> {
    const snapshot = await this.entityRef(ownerId, "documents", id).get();
    return snapshot.exists ? toDocument(snapshot.data()) : null;
  }

  public async listDocuments(
    ownerId: string,
    options: ListDocumentsOptions,
  ): Promise<Page<DocumentRecord>> {
    const cursorKey = options.cursorKey ?? "documents";
    const query: Query = this.database
      .collection(`users/${ownerId}/documents`)
      .where("ownerId", "==", ownerId)
      .orderBy("updatedAt", "desc");
    return this.scan(
      query,
      ownerId,
      cursorKey,
      options.pageToken,
      options.limit,
      toDocument,
      (item) =>
        Boolean(
          (options.includeDeleted || !item.deletedAt) &&
          (!options.kind || item.kind === options.kind) &&
          (!options.projectId || item.projectId === options.projectId),
        ),
    );
  }

  public async getProject(ownerId: string, id: string): Promise<ProjectRecord | null> {
    const snapshot = await this.entityRef(ownerId, "projects", id).get();
    return snapshot.exists ? toProject(snapshot.data()) : null;
  }

  public async listProjects(
    ownerId: string,
    options: ListProjectsOptions,
  ): Promise<Page<ProjectRecord>> {
    const cursorKey = options.cursorKey ?? "projects";
    const query: Query = this.database
      .collection(`users/${ownerId}/projects`)
      .where("ownerId", "==", ownerId)
      .orderBy("updatedAt", "desc");
    return this.scan(
      query,
      ownerId,
      cursorKey,
      options.pageToken,
      options.limit,
      toProject,
      (item) =>
        Boolean(
          !item.deletedAt &&
          (!options.status || item.status === options.status) &&
          (!options.tag || item.tags.includes(options.tag)) &&
          (!options.priority || item.priority === options.priority) &&
          (!options.health || item.health === options.health),
        ),
    );
  }

  public async listVersions(
    ownerId: string,
    options: ListVersionsOptions,
  ): Promise<Page<VersionRecord>> {
    const cursorKey = options.cursorKey ?? "versions";
    const query: Query = this.database
      .collection(`users/${ownerId}/versions`)
      .where("ownerId", "==", ownerId)
      .orderBy("updatedAt", "desc");
    return this.scan(
      query,
      ownerId,
      cursorKey,
      options.pageToken,
      options.limit,
      toVersion,
      (item) =>
        Boolean(!item.deletedAt && (!options.projectId || item.projectId === options.projectId)),
    );
  }

  public async getTask(ownerId: string, id: string): Promise<TaskRecord | null> {
    const snapshot = await this.entityRef(ownerId, "tasks", id).get();
    return snapshot.exists ? toTask(snapshot.data()) : null;
  }

  public async getCalendar(ownerId: string, id: string): Promise<CalendarRecord | null> {
    const snapshot = await this.entityRef(ownerId, "calendar", id).get();
    return snapshot.exists ? (snapshot.data() as CalendarRecord) : null;
  }

  public async listCalendar(
    ownerId: string,
    options: ListCalendarOptions,
  ): Promise<Page<CalendarRecord>> {
    const query: Query = this.database
      .collection(`users/${ownerId}/calendar`)
      .where("ownerId", "==", ownerId)
      .orderBy("updatedAt", "desc");
    return this.scan(
      query,
      ownerId,
      options.cursorKey ?? "calendar",
      options.pageToken,
      options.limit,
      (value) => value as CalendarRecord,
      (item) =>
        Boolean(
          (options.includeDeleted || !item.deletedAt) &&
          item.endDate >= options.startDate &&
          item.startDate <= options.endDate &&
          (!options.projectId || item.projectId === options.projectId) &&
          (!options.kind || item.kind === options.kind),
        ),
    );
  }

  public async listTasks(ownerId: string, options: ListTasksOptions): Promise<Page<TaskRecord>> {
    const cursorKey = options.cursorKey ?? "tasks";
    const query: Query = this.database
      .collection(`users/${ownerId}/tasks`)
      .where("ownerId", "==", ownerId)
      .orderBy("updatedAt", "desc");
    return this.scan(query, ownerId, cursorKey, options.pageToken, options.limit, toTask, (item) =>
      Boolean(
        (options.includeDeleted || !item.deletedAt) &&
        (!options.state || item.state === options.state) &&
        (!options.projectId || item.projectId === options.projectId) &&
        (!options.dueBefore || (item.dueDate && item.dueDate <= options.dueBefore)) &&
        (!options.dueAfter || (item.dueDate && item.dueDate >= options.dueAfter)) &&
        (!options.search ||
          `${item.title}\n${item.description ?? ""}\n${item.tags.join(" ")}`
            .toLocaleLowerCase()
            .includes(options.search.toLocaleLowerCase())),
      ),
    );
  }

  public writeDocument(input: DocumentWriteInput): Promise<WriteResult<DocumentRecord>> {
    return this.writeEntity("documents", input.documentId, input, input.mutate);
  }

  public writeProject(input: ProjectWriteInput): Promise<WriteResult<ProjectRecord>> {
    return this.writeEntity("projects", input.projectId, input, input.mutate);
  }

  public writeVersion(input: VersionWriteInput): Promise<WriteResult<VersionRecord>> {
    return this.writeEntity("versions", input.versionId, input, input.mutate);
  }

  public writeTask(input: TaskWriteInput): Promise<WriteResult<TaskRecord>> {
    return this.writeEntity("tasks", input.taskId, input, input.mutate);
  }
  public writeCalendar(input: CalendarWriteInput): Promise<WriteResult<CalendarRecord>> {
    return this.writeEntity("calendar", input.calendarId, input, input.mutate);
  }

  public async listAudit(ownerId: string, limit: number): Promise<readonly AuditEntry[]> {
    const snapshot = await this.database
      .collection(`users/${ownerId}/auditLogs`)
      .orderBy("createdAt", "desc")
      .limit(Math.min(limit, MAX_QUERY_PAGE))
      .get();
    return snapshot.docs.map((document) => document.data() as AuditEntry);
  }

  private async writeEntity<
    T extends DocumentRecord | ProjectRecord | VersionRecord | TaskRecord | CalendarRecord,
    I extends {
      ownerId: string;
      expectedRevision: number;
      idempotencyKey: string;
      tool: string;
      confirmation: Record<string, unknown> | null;
      inputSummary: Record<string, unknown>;
      mutate: (current: T | null) => T;
    },
  >(
    collection: "documents" | "projects" | "versions" | "tasks" | "calendar",
    id: string,
    input: I,
    mutate: (current: T | null) => T,
  ): Promise<WriteResult<T>> {
    const entityReference = this.entityRef(input.ownerId, collection, id);
    const idempotencyReference = this.entityRef(
      input.ownerId,
      "mcpIdempotency",
      hashId(input.idempotencyKey),
    );
    const auditReference = this.entityRef(
      input.ownerId,
      "auditLogs",
      `mcp-${hashId(input.idempotencyKey)}`,
    );
    const eventReference = this.entityRef(
      input.ownerId,
      "syncEvents",
      `mcp-${hashId(input.idempotencyKey)}`,
    );
    const now = new Date().toISOString();
    return this.database.runTransaction(async (transaction) => {
      const entitySnapshot = await transaction.get(entityReference);
      const idempotencySnapshot = await transaction.get(idempotencyReference);
      if (idempotencySnapshot.exists) {
        const stored = idempotencySnapshot.data() as StoredIdempotencyResult & {
          beforeRevision: number | null;
          afterRevision: number;
        };
        return {
          entity: stored.result.entity as T,
          replayed: true,
          beforeRevision: stored.beforeRevision,
          afterRevision: stored.afterRevision,
        };
      }
      const current = entitySnapshot.exists ? (entitySnapshot.data() as T) : null;
      const currentRevision = current ? current.revision : 0;
      if (currentRevision !== input.expectedRevision) {
        throw new McpRevisionConflictError(currentRevision);
      }
      const next = mutate(current);
      if (
        next.ownerId !== input.ownerId ||
        next.id !== id ||
        next.revision !== currentRevision + 1
      ) {
        throw new Error("Invalid write mutation.");
      }
      const eventId = `mcp-${hashId(input.idempotencyKey)}`;
      const audit: AuditEntry = {
        id: auditReference.id,
        ownerId: input.ownerId,
        tool: input.tool,
        inputSummary: input.inputSummary,
        affectedEntities: [`${collection}/${id}`],
        beforeRevision: current ? current.revision : null,
        afterRevision: next.revision,
        confirmation: input.confirmation,
        createdAt: now,
      };
      const result = { entity: next };
      transaction.set(entityReference, {
        ...next,
        idempotencyKey: input.idempotencyKey,
        lastEventId: eventId,
      });
      transaction.set(eventReference, {
        eventId,
        ownerId: input.ownerId,
        entityType: collection.slice(0, -1),
        entityId: id,
        operation: "upsert",
        revision: next.revision,
        payloadVersion: 1,
        payload: { ...next, idempotencyKey: input.idempotencyKey, lastEventId: eventId },
        createdAt: now,
        idempotencyKey: input.idempotencyKey,
        serverUpdatedAt: new Date(),
      });
      transaction.set(auditReference, audit);
      transaction.set(idempotencyReference, {
        idempotencyKey: input.idempotencyKey,
        tool: input.tool,
        result,
        beforeRevision: current ? current.revision : null,
        afterRevision: next.revision,
        createdAt: now,
      });
      return {
        entity: next,
        replayed: false,
        beforeRevision: current ? current.revision : null,
        afterRevision: next.revision,
      };
    });
  }

  private entityRef(ownerId: string, collection: string, id: string) {
    return this.database.doc(`users/${ownerId}/${collection}/${id}`);
  }

  private async scan<T>(
    query: Query,
    ownerId: string,
    cursorKey: string,
    token: string | undefined,
    limit: number,
    map: (value: FirebaseValue | undefined) => T,
    matches: (value: T) => boolean,
  ): Promise<Page<T>> {
    let offset = token ? this.cursors.decode(token, ownerId, cursorKey).offset : 0;
    const batchSize = Math.min(MAX_QUERY_PAGE, Math.max(limit, 20));
    const items: T[] = [];
    while (items.length < limit && offset <= 10_000) {
      const snapshot = await query.offset(offset).limit(batchSize).get();
      const raw = snapshot.docs.map((document) => map(document.data()));
      for (let index = 0; index < raw.length; index += 1) {
        const item = raw[index]!;
        if (matches(item)) items.push(item);
        if (items.length === limit) {
          const hasMore = index + 1 < raw.length || raw.length === batchSize;
          return {
            items,
            nextPageToken: hasMore
              ? this.cursors.encode({ ownerId, kind: cursorKey, offset: offset + index + 1 })
              : null,
          };
        }
      }
      if (raw.length < batchSize) return { items, nextPageToken: null };
      offset += raw.length;
    }
    return { items, nextPageToken: null };
  }
}

export class MemoryStoneStore implements StoneStore {
  public readonly audits: AuditEntry[] = [];
  private readonly documents = new Map<string, DocumentRecord>();
  private readonly projects = new Map<string, ProjectRecord>();
  private readonly versions = new Map<string, VersionRecord>();
  private readonly tasks = new Map<string, TaskRecord>();
  private readonly calendar = new Map<string, CalendarRecord>();
  private readonly idempotency = new Map<string, WriteResult<unknown>>();
  private readonly cursors = new CursorCodec("memory-store-cursor-secret");

  public seedDocument(document: DocumentRecord): void {
    this.documents.set(key(document.ownerId, document.id), structuredClone(document));
  }

  public seedProject(project: ProjectRecord): void {
    this.projects.set(key(project.ownerId, project.id), structuredClone(project));
  }

  public seedVersion(version: VersionRecord): void {
    this.versions.set(key(version.ownerId, version.id), structuredClone(version));
  }

  public seedTask(task: TaskRecord): void {
    this.tasks.set(key(task.ownerId, task.id), structuredClone(task));
  }
  public seedCalendar(item: CalendarRecord): void {
    this.calendar.set(key(item.ownerId, item.id), structuredClone(item));
  }

  public async getDocument(ownerId: string, id: string): Promise<DocumentRecord | null> {
    return clone(this.documents.get(key(ownerId, id)) ?? null);
  }

  public async listDocuments(
    ownerId: string,
    options: ListDocumentsOptions,
  ): Promise<Page<DocumentRecord>> {
    const values = [...this.documents.values()]
      .filter((item) => item.ownerId === ownerId)
      .filter((item) => options.includeDeleted || !item.deletedAt)
      .filter((item) => !options.kind || item.kind === options.kind)
      .filter((item) => !options.projectId || item.projectId === options.projectId)
      .sort(sortUpdated);
    return page(
      values,
      ownerId,
      options.cursorKey ?? "documents",
      options.pageToken,
      options.limit,
      this.cursors,
    );
  }

  public async getProject(ownerId: string, id: string): Promise<ProjectRecord | null> {
    return clone(this.projects.get(key(ownerId, id)) ?? null);
  }

  public async listProjects(
    ownerId: string,
    options: ListProjectsOptions,
  ): Promise<Page<ProjectRecord>> {
    const values = [...this.projects.values()]
      .filter((item) => item.ownerId === ownerId && !item.deletedAt)
      .filter((item) => !options.status || item.status === options.status)
      .filter((item) => !options.tag || item.tags.includes(options.tag))
      .filter((item) => !options.priority || item.priority === options.priority)
      .filter((item) => !options.health || item.health === options.health)
      .sort(sortUpdated);
    return page(
      values,
      ownerId,
      options.cursorKey ?? "projects",
      options.pageToken,
      options.limit,
      this.cursors,
    );
  }

  public async listVersions(
    ownerId: string,
    options: ListVersionsOptions,
  ): Promise<Page<VersionRecord>> {
    const values = [...this.versions.values()]
      .filter((item) => item.ownerId === ownerId && !item.deletedAt)
      .filter((item) => !options.projectId || item.projectId === options.projectId)
      .sort(sortUpdated);
    return page(
      values,
      ownerId,
      options.cursorKey ?? "versions",
      options.pageToken,
      options.limit,
      this.cursors,
    );
  }

  public async getTask(ownerId: string, id: string): Promise<TaskRecord | null> {
    return clone(this.tasks.get(key(ownerId, id)) ?? null);
  }

  public async listTasks(ownerId: string, options: ListTasksOptions): Promise<Page<TaskRecord>> {
    const search = options.search?.toLocaleLowerCase();
    const values = [...this.tasks.values()]
      .filter((item) => item.ownerId === ownerId)
      .filter((item) => options.includeDeleted || !item.deletedAt)
      .filter((item) => !options.state || item.state === options.state)
      .filter((item) => !options.projectId || item.projectId === options.projectId)
      .filter(
        (item) => !options.dueBefore || Boolean(item.dueDate && item.dueDate <= options.dueBefore),
      )
      .filter(
        (item) => !options.dueAfter || Boolean(item.dueDate && item.dueDate >= options.dueAfter),
      )
      .filter(
        (item) =>
          !search ||
          `${item.title}\n${item.description ?? ""}\n${item.tags.join(" ")}`
            .toLocaleLowerCase()
            .includes(search),
      )
      .sort(sortUpdated);
    return page(
      values,
      ownerId,
      options.cursorKey ?? "tasks",
      options.pageToken,
      options.limit,
      this.cursors,
    );
  }
  public async getCalendar(ownerId: string, id: string): Promise<CalendarRecord | null> {
    return clone(this.calendar.get(key(ownerId, id)) ?? null);
  }
  public async listCalendar(
    ownerId: string,
    options: ListCalendarOptions,
  ): Promise<Page<CalendarRecord>> {
    const values = [...this.calendar.values()]
      .filter((item) => item.ownerId === ownerId)
      .filter((item) => options.includeDeleted || !item.deletedAt)
      .filter((item) => item.endDate >= options.startDate && item.startDate <= options.endDate)
      .filter((item) => !options.projectId || item.projectId === options.projectId)
      .filter((item) => !options.kind || item.kind === options.kind)
      .sort(sortUpdated);
    return page(
      values,
      ownerId,
      options.cursorKey ?? "calendar",
      options.pageToken,
      options.limit,
      this.cursors,
    );
  }

  public writeDocument(input: DocumentWriteInput): Promise<WriteResult<DocumentRecord>> {
    return this.write(this.documents, input.documentId, input);
  }

  public writeProject(input: ProjectWriteInput): Promise<WriteResult<ProjectRecord>> {
    return this.write(this.projects, input.projectId, input);
  }

  public writeVersion(input: VersionWriteInput): Promise<WriteResult<VersionRecord>> {
    return this.write(this.versions, input.versionId, input);
  }

  public writeTask(input: TaskWriteInput): Promise<WriteResult<TaskRecord>> {
    return this.write(this.tasks, input.taskId, input);
  }
  public writeCalendar(input: CalendarWriteInput): Promise<WriteResult<CalendarRecord>> {
    return this.write(this.calendar, input.calendarId, input);
  }

  public async listAudit(ownerId: string, limit: number): Promise<readonly AuditEntry[]> {
    return this.audits
      .filter((entry) => entry.ownerId === ownerId)
      .slice(-limit)
      .reverse();
  }

  private async write<
    T extends DocumentRecord | ProjectRecord | VersionRecord | TaskRecord | CalendarRecord,
  >(
    values: Map<string, T>,
    id: string,
    input:
      | DocumentWriteInput
      | ProjectWriteInput
      | VersionWriteInput
      | TaskWriteInput
      | CalendarWriteInput,
  ): Promise<WriteResult<T>> {
    const idempotencyKey = `${input.ownerId}:${input.idempotencyKey}`;
    const replay = this.idempotency.get(idempotencyKey) as WriteResult<T> | undefined;
    if (replay) return { ...clone(replay), replayed: true };
    const current = values.get(key(input.ownerId, id)) ?? null;
    const currentRevision = current?.revision ?? 0;
    if (currentRevision !== input.expectedRevision)
      throw new McpRevisionConflictError(currentRevision);
    const next = (input as unknown as { mutate: (value: T | null) => T }).mutate(clone(current));
    if (next.ownerId !== input.ownerId || next.id !== id || next.revision !== currentRevision + 1) {
      throw new Error("Invalid write mutation.");
    }
    const result: WriteResult<T> = {
      entity: clone(next),
      replayed: false,
      beforeRevision: current?.revision ?? null,
      afterRevision: next.revision,
    };
    values.set(key(input.ownerId, id), clone(next));
    this.idempotency.set(idempotencyKey, clone(result));
    this.audits.push({
      id: `audit-${this.audits.length + 1}`,
      ownerId: input.ownerId,
      tool: input.tool,
      inputSummary: input.inputSummary,
      affectedEntities: [id],
      beforeRevision: result.beforeRevision,
      afterRevision: result.afterRevision,
      confirmation: input.confirmation,
      createdAt: new Date().toISOString(),
    });
    return result;
  }
}

function key(ownerId: string, id: string): string {
  return `${ownerId}:${id}`;
}

function hashId(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 40);
}

function page<T extends { id: string }>(
  values: readonly T[],
  ownerId: string,
  cursorKey: string,
  token: string | undefined,
  limit: number,
  cursors: CursorCodec,
): Page<T> {
  const offset = token ? cursors.decode(token, ownerId, cursorKey).offset : 0;
  const items = values.slice(offset, offset + limit);
  return {
    items: clone(items),
    nextPageToken:
      offset + limit < values.length
        ? cursors.encode({ ownerId, kind: cursorKey, offset: offset + limit })
        : null,
  };
}

function sortUpdated<T extends { updatedAt: string; id: string }>(left: T, right: T): number {
  return right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id);
}

function clone<T>(value: T): T {
  return value === null || value === undefined ? value : structuredClone(value);
}

function toDocument(value: FirebaseValue | undefined): DocumentRecord {
  return value as DocumentRecord;
}

function toProject(value: FirebaseValue | undefined): ProjectRecord {
  return value as ProjectRecord;
}

function toVersion(value: FirebaseValue | undefined): VersionRecord {
  return value as VersionRecord;
}

function toTask(value: FirebaseValue | undefined): TaskRecord {
  return value as TaskRecord;
}

type FirebaseValue = Record<string, unknown>;
