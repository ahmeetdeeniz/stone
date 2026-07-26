import type {
  RemoteChange,
  SyncEntityType,
  SyncLocalStore,
  OutboxEvent,
  ApplyRemoteResult,
} from "@stone/sync";
import { SyncTransportError } from "@stone/sync";
import { extractTasks } from "@stone/markdown";
import type { StoneDatabase } from "./database";

interface OutboxRow {
  id: string;
  owner_id: string;
  entity_type: string;
  entity_id: string;
  operation: string;
  base_revision: number;
  revision: number;
  payload_version: number;
  payload: string;
  created_at: string;
  attempt_count: number;
  next_attempt_at: string | null;
  idempotency_key: string;
  status: string;
  last_error: string | null;
}

interface ConflictRow {
  id: string;
  owner_id: string;
  entity_type: string;
  entity_id: string;
  base_revision: number;
  local_revision: number;
  remote_revision: number;
  base_payload: string | null;
  local_payload: string;
  remote_payload: string;
  status: string;
  resolution: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface LocalConflict {
  id: string;
  ownerId: string;
  entityType: SyncEntityType;
  entityId: string;
  baseRevision: number;
  localRevision: number;
  remoteRevision: number;
  basePayload: Record<string, unknown> | null;
  localPayload: Record<string, unknown>;
  remotePayload: Record<string, unknown>;
  status: "open" | "resolved";
  resolution: "local" | "remote" | "merged" | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface SyncState {
  status: "saved" | "syncing" | "offline" | "error" | "conflict";
  lastError: string | null;
  updatedAt: string;
}

export async function enqueueOutbox(
  database: StoneDatabase,
  input: Omit<OutboxEvent, "id" | "attemptCount" | "nextAttemptAt" | "lastError">,
): Promise<OutboxEvent> {
  const event: OutboxEvent = {
    ...input,
    id: input.idempotencyKey,
    attemptCount: 0,
    nextAttemptAt: null,
    lastError: null,
  };
  await database.runAsync(
    "INSERT INTO outbox (id, entity_type, entity_id, operation, base_revision, payload_version, payload, created_at, attempt_count, next_attempt_at, idempotency_key, owner_id, revision, status, last_error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(idempotency_key) DO NOTHING",
    event.id,
    event.entityType,
    event.entityId,
    event.operation,
    event.baseRevision,
    event.payloadVersion,
    JSON.stringify(event.payload),
    event.createdAt,
    event.attemptCount,
    event.nextAttemptAt,
    event.idempotencyKey,
    event.ownerId,
    event.revision,
    "pending",
    event.lastError,
  );
  return event;
}

export class SQLiteSyncStore implements SyncLocalStore {
  public constructor(private readonly database: StoneDatabase) {}

  public async pending(
    ownerId: string,
    now: string,
    limit: number,
  ): Promise<readonly OutboxEvent[]> {
    const rows = await this.database.getAllAsync<OutboxRow>(
      "SELECT id, owner_id, entity_type, entity_id, operation, base_revision, revision, payload_version, payload, created_at, attempt_count, next_attempt_at, idempotency_key, status, last_error FROM outbox WHERE owner_id = ? AND status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= ?) ORDER BY created_at ASC LIMIT ?",
      ownerId,
      now,
      limit,
    );
    return rows.map(toOutboxEvent);
  }

  public acknowledgeOutbox(eventId: string): Promise<void> {
    return this.database.runAsync("DELETE FROM outbox WHERE id = ?", eventId).then(() => undefined);
  }

  public async deferOutbox(eventId: string, nextAttemptAt: string, message: string): Promise<void> {
    await this.database.runAsync(
      "UPDATE outbox SET attempt_count = attempt_count + 1, next_attempt_at = ?, last_error = ? WHERE id = ?",
      nextAttemptAt,
      message,
      eventId,
    );
  }

  public async blockOutbox(eventId: string, message: string): Promise<void> {
    await this.database.runAsync(
      "UPDATE outbox SET status = 'blocked', last_error = ? WHERE id = ?",
      message,
      eventId,
    );
  }

  public async applyRemote(change: RemoteChange): Promise<ApplyRemoteResult> {
    const pending = await this.database.getFirstAsync<{
      id: string;
      base_revision: number;
      revision: number;
      idempotency_key: string;
    }>(
      "SELECT id, base_revision, revision, idempotency_key FROM outbox WHERE owner_id = ? AND entity_type = ? AND entity_id = ? AND status IN ('pending', 'blocked') ORDER BY revision DESC LIMIT 1",
      change.ownerId,
      change.entityType,
      change.entityId,
    );
    const localRevision = await this.localRevision(
      change.ownerId,
      change.entityType,
      change.entityId,
    );
    if (
      pending &&
      pending.idempotency_key !== change.idempotencyKey &&
      change.revision > pending.base_revision
    ) {
      await this.recordConflict(change, pending);
      await this.blockOutbox(pending.id, "Revision conflict requires user resolution.");
      return "conflict";
    }
    if (localRevision >= change.revision) return "ignored";
    await this.database.withTransactionAsync(async () => {
      switch (change.entityType) {
        case "document":
          await this.applyDocument(change);
          break;
        case "project":
          await this.applyProject(change);
          break;
        case "version":
          await this.applyVersion(change);
          break;
        case "device":
          await this.applyDevice(change);
          break;
        case "settings":
          await this.applySettings(change);
          break;
        default:
          throw new SyncTransportError("Unsupported sync entity.", false);
      }
    });
    return "applied";
  }

  public async getCursor(ownerId: string): Promise<string | null> {
    const row = await this.database.getFirstAsync<{ cursor: string | null }>(
      "SELECT cursor FROM sync_state_cursors WHERE owner_id = ? AND collection = 'events'",
      ownerId,
    );
    return row?.cursor ?? null;
  }

  public async saveCursor(ownerId: string, cursor: string): Promise<void> {
    await this.database.runAsync(
      "INSERT INTO sync_state_cursors (owner_id, collection, cursor) VALUES (?, 'events', ?) ON CONFLICT(owner_id, collection) DO UPDATE SET cursor = excluded.cursor",
      ownerId,
      cursor,
    );
  }

  public async countOpenConflicts(ownerId: string): Promise<number> {
    const row = await this.database.getFirstAsync<{ count: number }>(
      "SELECT COUNT(*) as count FROM conflicts WHERE owner_id = ? AND status = 'open'",
      ownerId,
    );
    return row?.count ?? 0;
  }

  public async listConflicts(ownerId: string): Promise<readonly LocalConflict[]> {
    const rows = await this.database.getAllAsync<ConflictRow>(
      "SELECT id, owner_id, entity_type, entity_id, base_revision, local_revision, remote_revision, base_payload, local_payload, remote_payload, status, resolution, created_at, resolved_at FROM conflicts WHERE owner_id = ? ORDER BY created_at DESC",
      ownerId,
    );
    return rows.map(toConflict);
  }

  public async resolveConflict(
    ownerId: string,
    conflictId: string,
    resolution: "local" | "remote" | "merged",
    mergedPayload: Record<string, unknown> | null,
    deviceId: string,
  ): Promise<void> {
    const conflict = await this.database.getFirstAsync<ConflictRow>(
      "SELECT id, owner_id, entity_type, entity_id, base_revision, local_revision, remote_revision, base_payload, local_payload, remote_payload, status, resolution, created_at, resolved_at FROM conflicts WHERE owner_id = ? AND id = ? AND status = 'open'",
      ownerId,
      conflictId,
    );
    if (!conflict) throw new Error("Conflict not found.");
    const payload =
      resolution === "local"
        ? parsePayload(conflict.local_payload)
        : resolution === "remote"
          ? parsePayload(conflict.remote_payload)
          : mergedPayload;
    if (!payload) throw new Error("Merged conflict payload is required.");
    const revision = Math.max(conflict.local_revision, conflict.remote_revision) + 1;
    const nextPayload = {
      ...payload,
      revision,
      updatedByDeviceId: deviceId,
      updatedAt: new Date().toISOString(),
    };
    await this.database.withTransactionAsync(async () => {
      await this.applyPayload({
        entityType: conflict.entity_type as SyncEntityType,
        entityId: conflict.entity_id,
        payload: nextPayload,
      });
      await this.database.runAsync(
        "UPDATE conflicts SET status = 'resolved', resolution = ?, resolved_at = ? WHERE owner_id = ? AND id = ?",
        resolution,
        new Date().toISOString(),
        ownerId,
        conflictId,
      );
      await this.database.runAsync(
        "DELETE FROM outbox WHERE owner_id = ? AND entity_type = ? AND entity_id = ? AND status = 'blocked' AND id <> (SELECT id FROM outbox WHERE owner_id = ? AND entity_type = ? AND entity_id = ? AND status = 'blocked' ORDER BY revision DESC LIMIT 1)",
        ownerId,
        conflict.entity_type,
        conflict.entity_id,
        ownerId,
        conflict.entity_type,
        conflict.entity_id,
      );
      await this.database.runAsync(
        "UPDATE outbox SET id = ?, idempotency_key = ?, status = 'pending', base_revision = ?, revision = ?, payload = ?, next_attempt_at = NULL, last_error = NULL WHERE owner_id = ? AND entity_type = ? AND entity_id = ? AND status = 'blocked'",
        `${deviceId}:${conflict.entity_type}:${conflict.entity_id}:${revision}`,
        `${deviceId}:${conflict.entity_type}:${conflict.entity_id}:${revision}`,
        Math.max(conflict.local_revision, conflict.remote_revision),
        revision,
        JSON.stringify(nextPayload),
        ownerId,
        conflict.entity_type,
        conflict.entity_id,
      );
    });
  }

  public async setState(ownerId: string, state: SyncState): Promise<void> {
    await this.database.runAsync(
      "INSERT INTO sync_state (owner_id, status, last_error, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(owner_id) DO UPDATE SET status = excluded.status, last_error = excluded.last_error, updated_at = excluded.updated_at",
      ownerId,
      state.status,
      state.lastError,
      state.updatedAt,
    );
  }

  public async getState(ownerId: string): Promise<SyncState> {
    const row = await this.database.getFirstAsync<SyncState>(
      "SELECT status, last_error as lastError, updated_at as updatedAt FROM sync_state WHERE owner_id = ?",
      ownerId,
    );
    return row ?? { status: "saved", lastError: null, updatedAt: new Date(0).toISOString() };
  }

  private async localRevision(
    ownerId: string,
    entityType: SyncEntityType,
    entityId: string,
  ): Promise<number> {
    const table = tableForEntity(entityType);
    const row = await this.database.getFirstAsync<{ revision: number }>(
      `SELECT revision FROM ${table} WHERE owner_id = ? AND id = ?`,
      ownerId,
      entityId,
    );
    return row?.revision ?? 0;
  }

  private async recordConflict(
    change: RemoteChange,
    pending: { base_revision: number },
  ): Promise<void> {
    const localPayload = await this.localPayload(
      change.entityType,
      change.entityId,
      change.ownerId,
    );
    const basePayload = await this.basePayload(
      change.entityType,
      change.entityId,
      change.ownerId,
      pending.base_revision,
      localPayload,
    );
    const localRevision = await this.localRevision(
      change.ownerId,
      change.entityType,
      change.entityId,
    );
    await this.database.runAsync(
      "INSERT INTO conflicts (id, owner_id, entity_type, entity_id, base_revision, local_revision, remote_revision, base_payload, local_payload, remote_payload, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?) ON CONFLICT(id) DO NOTHING",
      `${change.entityType}:${change.entityId}:${change.idempotencyKey}`,
      change.ownerId,
      change.entityType,
      change.entityId,
      pending.base_revision,
      localRevision,
      change.revision,
      basePayload ? JSON.stringify(basePayload) : null,
      JSON.stringify(localPayload ?? {}),
      JSON.stringify(change.payload),
      new Date().toISOString(),
    );
  }

  private async localPayload(
    entityType: SyncEntityType,
    entityId: string,
    ownerId: string,
  ): Promise<Record<string, unknown> | null> {
    const table = tableForEntity(entityType);
    const row = await this.database.getFirstAsync<Record<string, unknown>>(
      `SELECT * FROM ${table} WHERE owner_id = ? AND id = ?`,
      ownerId,
      entityId,
    );
    return row ? normalizeSqlPayload(entityType, row) : null;
  }

  private async basePayload(
    entityType: SyncEntityType,
    entityId: string,
    ownerId: string,
    revision: number,
    localPayload: Record<string, unknown> | null,
  ): Promise<Record<string, unknown> | null> {
    if (entityType !== "document" || !localPayload || revision <= 0) return null;
    const snapshot = await this.database.getFirstAsync<{
      markdown: string;
      created_at: string;
    }>(
      "SELECT r.markdown, r.created_at FROM document_revisions r JOIN documents d ON d.id = r.document_id WHERE d.owner_id = ? AND r.document_id = ? AND r.revision = ?",
      ownerId,
      entityId,
      revision,
    );
    return snapshot
      ? { ...localPayload, revision, markdown: snapshot.markdown, updatedAt: snapshot.created_at }
      : null;
  }

  private async applyDocument(change: RemoteChange): Promise<void> {
    const payload = change.payload;
    await this.database.runAsync(
      "INSERT INTO documents (id, owner_id, kind, title, markdown, path, project_id, is_pinned, revision, created_at, updated_at, deleted_at, updated_by_device_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET owner_id = excluded.owner_id, kind = excluded.kind, title = excluded.title, markdown = excluded.markdown, path = excluded.path, project_id = excluded.project_id, is_pinned = excluded.is_pinned, revision = excluded.revision, created_at = excluded.created_at, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at, updated_by_device_id = excluded.updated_by_device_id",
      bindValue(payload.id),
      bindValue(payload.ownerId),
      bindValue(payload.kind),
      bindValue(payload.title),
      bindValue(payload.markdown),
      bindValue(payload.path),
      bindValue(payload.projectId),
      payload.isPinned ? 1 : 0,
      bindValue(payload.revision),
      bindValue(payload.createdAt),
      bindValue(payload.updatedAt),
      bindValue(payload.deletedAt),
      bindValue(payload.updatedByDeviceId),
    );
    await this.database.runAsync(
      "INSERT OR IGNORE INTO document_revisions (id, document_id, revision, markdown, created_at) VALUES (?, ?, ?, ?, ?)",
      `${String(payload.id)}:${String(payload.revision)}`,
      bindValue(payload.id),
      bindValue(payload.revision),
      bindValue(payload.markdown),
      bindValue(payload.updatedAt),
    );
    await this.database.runAsync(
      "DELETE FROM documents_fts WHERE document_id = ?",
      bindValue(payload.id),
    );
    if (!payload.deletedAt) {
      await this.database.runAsync(
        "INSERT INTO documents_fts (document_id, owner_id, title, markdown) VALUES (?, ?, ?, ?)",
        bindValue(payload.id),
        bindValue(payload.ownerId),
        bindValue(payload.title),
        bindValue(payload.markdown),
      );
    }
    await this.rebuildTaskIndex(payload);
  }

  private async applyProject(change: RemoteChange): Promise<void> {
    const p = change.payload;
    await this.database.runAsync(
      "INSERT INTO projects (id, owner_id, canonical_document_id, title, status, priority, updated_at, slug, tags, target_date, current_version, next_version, next_action, repository_url, platforms, health, revision, created_at, deleted_at, updated_by_device_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET owner_id = excluded.owner_id, canonical_document_id = excluded.canonical_document_id, title = excluded.title, status = excluded.status, priority = excluded.priority, updated_at = excluded.updated_at, slug = excluded.slug, tags = excluded.tags, target_date = excluded.target_date, current_version = excluded.current_version, next_version = excluded.next_version, next_action = excluded.next_action, repository_url = excluded.repository_url, platforms = excluded.platforms, health = excluded.health, revision = excluded.revision, created_at = excluded.created_at, deleted_at = excluded.deleted_at, updated_by_device_id = excluded.updated_by_device_id",
      bindValue(p.id),
      bindValue(p.ownerId),
      bindValue(p.canonicalDocumentId),
      bindValue(p.title),
      bindValue(p.status),
      bindValue(p.priority),
      bindValue(p.updatedAt),
      bindValue(p.slug),
      JSON.stringify(p.tags ?? []),
      bindValue(p.targetDate),
      bindValue(p.currentVersion),
      bindValue(p.nextVersion),
      bindValue(p.nextAction),
      bindValue(p.repositoryUrl),
      JSON.stringify(p.platforms ?? []),
      bindValue(p.health),
      bindValue(p.revision),
      bindValue(p.createdAt),
      bindValue(p.deletedAt),
      bindValue(p.updatedByDeviceId),
    );
  }

  private async applyVersion(change: RemoteChange): Promise<void> {
    const p = change.payload;
    await this.database.runAsync(
      "INSERT INTO versions (id, owner_id, project_id, canonical_document_id, version, status, updated_at, target_date, android_status, ios_status, completed_tasks, total_tasks, revision, created_at, deleted_at, updated_by_device_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET owner_id = excluded.owner_id, project_id = excluded.project_id, canonical_document_id = excluded.canonical_document_id, version = excluded.version, status = excluded.status, updated_at = excluded.updated_at, target_date = excluded.target_date, android_status = excluded.android_status, ios_status = excluded.ios_status, completed_tasks = excluded.completed_tasks, total_tasks = excluded.total_tasks, revision = excluded.revision, created_at = excluded.created_at, deleted_at = excluded.deleted_at, updated_by_device_id = excluded.updated_by_device_id",
      bindValue(p.id),
      bindValue(p.ownerId),
      bindValue(p.projectId),
      bindValue(p.canonicalDocumentId),
      bindValue(p.version),
      bindValue(p.status),
      bindValue(p.updatedAt),
      bindValue(p.targetDate),
      bindValue(p.androidStatus),
      bindValue(p.iosStatus),
      bindValue(p.completedTasks ?? 0),
      bindValue(p.totalTasks ?? 0),
      bindValue(p.revision),
      bindValue(p.createdAt),
      bindValue(p.deletedAt),
      bindValue(p.updatedByDeviceId),
    );
  }

  private async applyDevice(change: RemoteChange): Promise<void> {
    const p = change.payload;
    await this.database.runAsync(
      "INSERT INTO devices (id, owner_id, platform, name, app_version, last_seen_at, revision) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET owner_id = excluded.owner_id, platform = excluded.platform, name = excluded.name, app_version = excluded.app_version, last_seen_at = excluded.last_seen_at, revision = excluded.revision",
      bindValue(p.id),
      bindValue(p.ownerId),
      bindValue(p.platform),
      bindValue(p.name),
      bindValue(p.appVersion),
      bindValue(p.lastSeenAt),
      bindValue(p.revision),
    );
  }

  private async applySettings(change: RemoteChange): Promise<void> {
    const p = change.payload;
    await this.database.runAsync(
      "INSERT INTO settings (owner_id, theme, reduce_motion, editor_font_size, trash_retention_days, revision) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(owner_id) DO UPDATE SET theme = excluded.theme, reduce_motion = excluded.reduce_motion, editor_font_size = excluded.editor_font_size, trash_retention_days = excluded.trash_retention_days, revision = excluded.revision",
      bindValue(p.ownerId),
      bindValue(p.theme),
      p.reduceMotion ? 1 : 0,
      bindValue(p.editorFontSize),
      bindValue(p.trashRetentionDays),
      bindValue(p.revision),
    );
  }

  private async rebuildTaskIndex(payload: Record<string, unknown>): Promise<void> {
    const kind = asText(payload.kind);
    if (!["project", "version", "inbox", "release_checklist"].includes(kind)) return;
    const ownerId = String(payload.ownerId);
    const documentId = String(payload.id);
    await this.database.runAsync(
      "DELETE FROM tasks_index WHERE owner_id = ? AND document_id = ?",
      ownerId,
      documentId,
    );
    if (payload.projectId) {
      await this.database.runAsync(
        "DELETE FROM project_blockers WHERE owner_id = ? AND project_id = ?",
        ownerId,
        bindValue(payload.projectId),
      );
    }
    if (payload.deletedAt) return;
    const version = await this.database.getFirstAsync<{ id: string }>(
      "SELECT id FROM versions WHERE owner_id = ? AND canonical_document_id = ? AND deleted_at IS NULL",
      ownerId,
      documentId,
    );
    for (const task of extractTasks(asText(payload.markdown))) {
      await this.database.runAsync(
        "INSERT INTO tasks_index (id, owner_id, document_id, text, completed, updated_at, project_id, version_id, line_anchor, priority, due_date, blocked, blocker_text, canceled, revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        task.metadata?.id ?? task.id,
        ownerId,
        documentId,
        task.text,
        task.checked ? 1 : 0,
        bindValue(payload.updatedAt),
        bindValue(payload.projectId),
        version?.id ?? null,
        `${task.from}:${task.to}`,
        task.metadata?.priority ?? null,
        task.metadata?.due ?? null,
        task.metadata?.blocked ? 1 : 0,
        task.metadata?.blocker ?? null,
        task.canceled ? 1 : 0,
        bindValue(payload.revision),
      );
      if (payload.projectId && task.metadata?.blocked && task.metadata.blocker) {
        await this.database.runAsync(
          "INSERT OR REPLACE INTO project_blockers (id, owner_id, project_id, task_id, text, resolved, created_at, resolved_at) VALUES (?, ?, ?, ?, ?, 0, ?, NULL)",
          task.metadata.id ?? task.id,
          ownerId,
          bindValue(payload.projectId),
          task.metadata.id ?? task.id,
          task.metadata.blocker,
          bindValue(payload.updatedAt),
        );
      }
    }
  }

  private applyPayload(input: {
    entityType: SyncEntityType;
    entityId: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
    const change: RemoteChange = {
      eventId: `local:${input.entityId}`,
      ownerId: String(input.payload.ownerId),
      entityType: input.entityType,
      entityId: input.entityId,
      operation: "upsert",
      revision: Number(input.payload.revision),
      payloadVersion: 1,
      payload: input.payload,
      createdAt: asText(input.payload.updatedAt) || new Date().toISOString(),
      idempotencyKey: `local:${input.entityId}:${String(input.payload.revision)}`,
    };
    switch (change.entityType) {
      case "document":
        return this.applyDocument(change);
      case "project":
        return this.applyProject(change);
      case "version":
        return this.applyVersion(change);
      case "device":
        return this.applyDevice(change);
      case "settings":
        return this.applySettings(change);
    }
  }
}

function toOutboxEvent(row: OutboxRow): OutboxEvent {
  return {
    id: row.id,
    ownerId: row.owner_id,
    entityType: row.entity_type as SyncEntityType,
    entityId: row.entity_id,
    operation: row.operation as OutboxEvent["operation"],
    baseRevision: row.base_revision,
    revision: row.revision,
    payloadVersion: 1,
    payload: parsePayload(row.payload),
    createdAt: row.created_at,
    attemptCount: row.attempt_count,
    nextAttemptAt: row.next_attempt_at,
    idempotencyKey: row.idempotency_key,
    lastError: row.last_error,
  };
}

function toConflict(row: ConflictRow): LocalConflict {
  return {
    id: row.id,
    ownerId: row.owner_id,
    entityType: row.entity_type as SyncEntityType,
    entityId: row.entity_id,
    baseRevision: row.base_revision,
    localRevision: row.local_revision,
    remoteRevision: row.remote_revision,
    basePayload: row.base_payload ? parsePayload(row.base_payload) : null,
    localPayload: parsePayload(row.local_payload),
    remotePayload: parsePayload(row.remote_payload),
    status: row.status as LocalConflict["status"],
    resolution: row.resolution as LocalConflict["resolution"],
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  };
}

function parsePayload(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("Invalid sync payload.");
  return parsed as Record<string, unknown>;
}

function tableForEntity(entityType: SyncEntityType): string {
  switch (entityType) {
    case "document":
      return "documents";
    case "project":
      return "projects";
    case "version":
      return "versions";
    case "device":
      return "devices";
    case "settings":
      return "settings";
  }
}

function normalizeSqlPayload(
  entityType: SyncEntityType,
  row: Record<string, unknown>,
): Record<string, unknown> {
  if (entityType === "document") {
    return {
      id: row.id,
      ownerId: row.owner_id,
      kind: row.kind,
      title: row.title,
      markdown: row.markdown,
      path: row.path,
      projectId: row.project_id,
      isPinned: row.is_pinned === 1,
      revision: row.revision,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at,
      updatedByDeviceId: row.updated_by_device_id,
    };
  }
  if (entityType === "project") {
    return {
      id: row.id,
      ownerId: row.owner_id,
      canonicalDocumentId: row.canonical_document_id,
      title: row.title,
      slug: row.slug,
      status: row.status,
      priority: row.priority,
      tags: parseJsonArray(row.tags),
      targetDate: row.target_date,
      currentVersion: row.current_version,
      nextVersion: row.next_version,
      nextAction: row.next_action,
      repositoryUrl: row.repository_url,
      platforms: parseJsonArray(row.platforms),
      health: row.health,
      revision: row.revision,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at,
      updatedByDeviceId: row.updated_by_device_id,
    };
  }
  if (entityType === "version") {
    return {
      id: row.id,
      ownerId: row.owner_id,
      projectId: row.project_id,
      canonicalDocumentId: row.canonical_document_id,
      version: row.version,
      status: row.status,
      updatedAt: row.updated_at,
      targetDate: row.target_date,
      androidStatus: row.android_status,
      iosStatus: row.ios_status,
      completedTasks: row.completed_tasks,
      totalTasks: row.total_tasks,
      revision: row.revision,
      createdAt: row.created_at,
      deletedAt: row.deleted_at,
      updatedByDeviceId: row.updated_by_device_id,
    };
  }
  if (entityType === "device") {
    return {
      id: row.id,
      ownerId: row.owner_id,
      platform: row.platform,
      name: row.name,
      appVersion: row.app_version,
      lastSeenAt: row.last_seen_at,
      revision: row.revision,
    };
  }
  if (entityType === "settings") {
    return {
      ownerId: row.owner_id,
      theme: row.theme,
      reduceMotion: row.reduce_motion === 1,
      editorFontSize: row.editor_font_size,
      trashRetentionDays: row.trash_retention_days,
      revision: row.revision,
    };
  }
  return row;
}

function parseJsonArray(value: unknown): readonly unknown[] {
  if (typeof value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function bindValue(value: unknown): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  return JSON.stringify(value);
}

function asText(value: unknown): string {
  return typeof value === "string"
    ? value
    : typeof value === "number" || typeof value === "boolean"
      ? String(value)
      : "";
}
