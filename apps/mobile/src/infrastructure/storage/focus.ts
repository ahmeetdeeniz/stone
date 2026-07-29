import {
  validateFocusGoal,
  validateFocusSession,
  type FocusGoal,
  type FocusRepository,
  type FocusSession,
  type FocusSessionListOptions,
} from "@stone/domain";
import type { StoneDatabase } from "./database";
import { enqueueOutbox } from "./sync";

interface PayloadRow {
  payload: string;
}

export class SQLiteFocusRepository implements FocusRepository {
  public constructor(
    private readonly database: StoneDatabase,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  public async create(source: FocusSession): Promise<FocusSession> {
    const session = validateFocusSession(source);
    const active = await this.getActive(session.ownerId);
    if (active.some((candidate) => candidate.id !== session.id))
      throw new Error("An active focus session already exists.");
    await this.database.withTransactionAsync(async () => {
      await writeSession(this.database, session, "INSERT");
      await queueSession(this.database, session, 0);
    });
    return session;
  }

  public async getById(
    ownerId: string,
    id: string,
    includeDeleted = false,
  ): Promise<FocusSession | null> {
    const row = await this.database.getFirstAsync<PayloadRow>(
      `SELECT payload FROM focus_sessions WHERE owner_id = ? AND id = ? ${includeDeleted ? "" : "AND deleted_at IS NULL"}`,
      ownerId,
      id,
    );
    return row ? parseSession(row) : null;
  }

  public async getActive(ownerId: string): Promise<readonly FocusSession[]> {
    const rows = await this.database.getAllAsync<PayloadRow>(
      "SELECT payload FROM focus_sessions WHERE owner_id = ? AND deleted_at IS NULL AND status IN ('running', 'paused') ORDER BY updated_at DESC, id LIMIT 10",
      ownerId,
    );
    return rows.map(parseSession);
  }

  public async list(
    ownerId: string,
    options: FocusSessionListOptions,
  ): Promise<readonly FocusSession[]> {
    const limit = Math.max(1, Math.min(options.limit ?? 2_000, 10_000));
    const rows = await this.database.getAllAsync<PayloadRow>(
      `SELECT payload FROM focus_sessions
       WHERE owner_id = ? AND started_at < ? AND COALESCE(ended_at, updated_at) >= ?
       ${options.includeDeleted ? "" : "AND deleted_at IS NULL"}
       ${options.status ? "AND status = ?" : ""}
       ${options.taskId ? "AND task_id = ?" : ""}
       ${options.projectId ? "AND project_id = ?" : ""}
       ORDER BY started_at DESC, id LIMIT ?`,
      ...[
        ownerId,
        options.endAt,
        options.startAt,
        options.status,
        options.taskId,
        options.projectId,
        limit,
      ].filter((value) => value !== undefined),
    );
    return rows.map(parseSession);
  }

  public async save(
    ownerId: string,
    source: FocusSession,
    expectedRevision: number,
    deviceId: string,
  ): Promise<FocusSession> {
    const current = await this.getById(ownerId, source.id, true);
    if (!current) throw new Error("Focus session not found.");
    if (current.revision !== expectedRevision) throw new Error("Focus session revision conflict.");
    const session = validateFocusSession({
      ...source,
      ownerId,
      createdAt: current.createdAt,
      updatedAt: this.now(),
      updatedByDeviceId: deviceId,
      revision: current.revision + 1,
    });
    await this.database.withTransactionAsync(async () => {
      await writeSession(this.database, session, "UPDATE");
      await queueSession(this.database, session, current.revision);
    });
    return session;
  }

  public async softDelete(ownerId: string, id: string, deviceId: string): Promise<FocusSession> {
    const current = await this.getById(ownerId, id);
    if (!current) throw new Error("Focus session not found.");
    if (current.status === "running" || current.status === "paused")
      throw new Error("Finish or cancel the active focus session before deleting it.");
    return this.save(ownerId, { ...current, deletedAt: this.now() }, current.revision, deviceId);
  }

  public async getGoal(ownerId: string): Promise<FocusGoal | null> {
    const row = await this.database.getFirstAsync<PayloadRow>(
      "SELECT payload FROM focus_goals WHERE owner_id = ?",
      ownerId,
    );
    return row ? validateFocusGoal(JSON.parse(row.payload) as FocusGoal) : null;
  }

  public async saveGoal(goal: FocusGoal, expectedRevision: number | null): Promise<FocusGoal> {
    const current = await this.getGoal(goal.ownerId);
    if ((current?.revision ?? null) !== expectedRevision)
      throw new Error("Focus goal revision conflict.");
    const timestamp = this.now();
    const next = validateFocusGoal({
      ...goal,
      id: goal.ownerId,
      revision: (current?.revision ?? 0) + 1,
      createdAt: current?.createdAt ?? timestamp,
      updatedAt: timestamp,
    });
    await this.database.withTransactionAsync(async () => {
      await this.database.runAsync(
        "INSERT INTO focus_goals (owner_id, effective_from_date, timezone, revision, updated_at, payload) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(owner_id) DO UPDATE SET effective_from_date=excluded.effective_from_date, timezone=excluded.timezone, revision=excluded.revision, updated_at=excluded.updated_at, payload=excluded.payload",
        next.ownerId,
        next.effectiveFromDate,
        next.timezone,
        next.revision,
        next.updatedAt,
        JSON.stringify(next),
      );
      await enqueueOutbox(this.database, {
        ownerId: next.ownerId,
        entityType: "focus_goal",
        entityId: next.ownerId,
        operation: "upsert",
        baseRevision: current?.revision ?? 0,
        revision: next.revision,
        payloadVersion: 1,
        payload: next as unknown as Record<string, unknown>,
        createdAt: next.updatedAt,
        idempotencyKey: `${next.updatedByDeviceId}:focus_goal:${next.ownerId}:${next.revision}`,
      });
    });
    return next;
  }

  public async listForExport(ownerId: string): Promise<readonly FocusSession[]> {
    const rows = await this.database.getAllAsync<PayloadRow>(
      "SELECT payload FROM focus_sessions WHERE owner_id = ? ORDER BY started_at, id LIMIT 50000",
      ownerId,
    );
    return rows.map(parseSession);
  }
}

function parseSession(row: PayloadRow): FocusSession {
  return validateFocusSession(JSON.parse(row.payload) as FocusSession);
}

async function writeSession(
  database: StoneDatabase,
  session: FocusSession,
  operation: "INSERT" | "UPDATE",
): Promise<void> {
  const values = [
    session.ownerId,
    session.schemaVersion,
    session.mode,
    session.status,
    session.phase,
    session.startedAt,
    session.endedAt,
    session.taskId,
    session.projectId,
    session.sourceDocumentId,
    session.calendarItemId,
    session.activeDeviceId,
    session.conflictState,
    session.revision,
    session.updatedAt,
    session.deletedAt,
    JSON.stringify(session),
  ] as const;
  if (operation === "INSERT") {
    await database.runAsync(
      "INSERT INTO focus_sessions (id, owner_id, schema_version, mode, status, phase, started_at, ended_at, task_id, project_id, source_document_id, calendar_item_id, active_device_id, conflict_state, revision, updated_at, deleted_at, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      session.id,
      ...values,
    );
  } else {
    await database.runAsync(
      "UPDATE focus_sessions SET owner_id=?, schema_version=?, mode=?, status=?, phase=?, started_at=?, ended_at=?, task_id=?, project_id=?, source_document_id=?, calendar_item_id=?, active_device_id=?, conflict_state=?, revision=?, updated_at=?, deleted_at=?, payload=? WHERE id=?",
      ...values,
      session.id,
    );
  }
}

async function queueSession(
  database: StoneDatabase,
  session: FocusSession,
  baseRevision: number,
): Promise<void> {
  await enqueueOutbox(database, {
    ownerId: session.ownerId,
    entityType: "focus",
    entityId: session.id,
    operation: session.deletedAt ? "delete" : "upsert",
    baseRevision,
    revision: session.revision,
    payloadVersion: 1,
    payload: session as unknown as Record<string, unknown>,
    createdAt: session.updatedAt,
    idempotencyKey: `${session.updatedByDeviceId}:focus:${session.id}:${session.revision}`,
  });
}
