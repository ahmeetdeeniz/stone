import {
  matchesCalendarList,
  validateCalendarItem,
  type CalendarItem,
  type CalendarListOptions,
  type CalendarRepository,
} from "@stone/domain";
import type { StoneDatabase } from "./database";
import { enqueueOutbox } from "./sync";

interface CalendarRow {
  payload: string;
}

export class SQLiteCalendarRepository implements CalendarRepository {
  public constructor(
    private readonly database: StoneDatabase,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  public async create(source: CalendarItem): Promise<CalendarItem> {
    const item = validateCalendarItem(source);
    await this.database.withTransactionAsync(async () => {
      await write(this.database, item, "INSERT");
      await queue(this.database, item, 0);
    });
    return item;
  }

  public async getById(
    ownerId: string,
    id: string,
    includeDeleted = false,
  ): Promise<CalendarItem | null> {
    const row = await this.database.getFirstAsync<CalendarRow>(
      `SELECT payload FROM calendar_items WHERE owner_id = ? AND id = ? ${includeDeleted ? "" : "AND deleted_at IS NULL"}`,
      ownerId,
      id,
    );
    return row ? parse(row) : null;
  }

  public async list(
    ownerId: string,
    options: CalendarListOptions,
  ): Promise<readonly CalendarItem[]> {
    const limit = Math.max(1, Math.min(options.limit ?? 1_000, 5_000));
    const rows = await this.database.getAllAsync<CalendarRow>(
      "SELECT payload FROM calendar_items WHERE owner_id = ? AND end_date >= ? AND start_date <= ? ORDER BY start_date, start_at, id LIMIT ?",
      ownerId,
      options.startDate,
      options.endDate,
      limit,
    );
    return rows.map(parse).filter((item) => matchesCalendarList(item, options));
  }

  public async save(
    ownerId: string,
    source: CalendarItem,
    expectedRevision: number,
    deviceId: string,
  ): Promise<CalendarItem> {
    const current = await this.getById(ownerId, source.id, true);
    if (!current) throw new Error("Calendar item not found.");
    if (current.revision !== expectedRevision) throw new Error("Calendar revision conflict.");
    const next = validateCalendarItem({
      ...source,
      ownerId,
      createdAt: current.createdAt,
      revision: current.revision + 1,
      updatedAt: this.now(),
      updatedByDeviceId: deviceId,
    });
    await this.database.withTransactionAsync(async () => {
      await write(this.database, next, "UPDATE");
      await queue(this.database, next, current.revision);
    });
    return next;
  }

  public async softDelete(ownerId: string, id: string, deviceId: string): Promise<CalendarItem> {
    const current = await this.getById(ownerId, id);
    if (!current) throw new Error("Calendar item not found.");
    const timestamp = this.now();
    return this.save(
      ownerId,
      { ...current, deletedAt: timestamp, cancelledAt: timestamp },
      current.revision,
      deviceId,
    );
  }
}

async function write(
  database: StoneDatabase,
  item: CalendarItem,
  operation: "INSERT" | "UPDATE",
): Promise<void> {
  const values = [
    item.ownerId,
    item.schemaVersion,
    item.kind,
    item.title,
    item.startDate,
    item.endDate,
    item.startAt,
    item.endAt,
    item.timezone,
    item.projectId,
    item.sourceDocumentId,
    item.taskId,
    item.category,
    item.recurrenceSeriesId,
    item.revision,
    item.updatedAt,
    item.deletedAt,
    JSON.stringify(item),
  ] as const;
  if (operation === "INSERT") {
    await database.runAsync(
      "INSERT INTO calendar_items (id, owner_id, schema_version, kind, title, start_date, end_date, start_at, end_at, timezone, project_id, source_document_id, task_id, category, recurrence_series_id, revision, updated_at, deleted_at, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      item.id,
      ...values,
    );
  } else {
    await database.runAsync(
      "UPDATE calendar_items SET owner_id=?, schema_version=?, kind=?, title=?, start_date=?, end_date=?, start_at=?, end_at=?, timezone=?, project_id=?, source_document_id=?, task_id=?, category=?, recurrence_series_id=?, revision=?, updated_at=?, deleted_at=?, payload=? WHERE id=?",
      ...values,
      item.id,
    );
  }
}

function parse(row: CalendarRow): CalendarItem {
  return validateCalendarItem(JSON.parse(row.payload) as CalendarItem);
}

async function queue(
  database: StoneDatabase,
  item: CalendarItem,
  baseRevision: number,
): Promise<void> {
  await enqueueOutbox(database, {
    ownerId: item.ownerId,
    entityType: "calendar",
    entityId: item.id,
    operation: item.deletedAt ? "delete" : "upsert",
    baseRevision,
    revision: item.revision,
    payloadVersion: 1,
    payload: item as unknown as Record<string, unknown>,
    createdAt: item.updatedAt,
    idempotencyKey: `${item.updatedByDeviceId}:calendar:${item.id}:${item.revision}`,
  });
}
