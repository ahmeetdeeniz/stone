import * as Crypto from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";
import type { Drawing, DrawingRepository, DrawingRevision } from "@stone/domain";
import { parseInk, serializeInk } from "@stone/ink";
import type { StoneDatabase } from "./database";
import { enqueueOutbox } from "./sync";

interface DrawingRow {
  id: string;
  owner_id: string;
  document_id: string | null;
  title: string;
  source_path: string;
  preview_path: string;
  source_sha256: string;
  preview_sha256: string;
  source_size: number;
  preview_size: number;
  revision: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  updated_by_device_id: string;
}

interface DrawingRevisionRow {
  id: string;
  drawing_id: string;
  revision: number;
  source_path: string;
  preview_path: string;
  created_at: string;
}

export class SQLiteDrawingRepository implements DrawingRepository {
  public constructor(private readonly database: StoneDatabase) {}

  public async getById(
    ownerId: string,
    id: string,
    includeDeleted = false,
  ): Promise<Drawing | null> {
    const row = await this.database.getFirstAsync<DrawingRow>(
      `SELECT id, owner_id, document_id, title, source_path, preview_path, source_sha256, preview_sha256, source_size, preview_size, revision, created_at, updated_at, deleted_at, updated_by_device_id FROM drawings WHERE owner_id = ? AND id = ? ${includeDeleted ? "" : "AND deleted_at IS NULL"}`,
      ownerId,
      id,
    );
    return row ? toDrawing(row) : null;
  }

  public async list(ownerId: string, documentId?: string): Promise<readonly Drawing[]> {
    const rows = await this.database.getAllAsync<DrawingRow>(
      `SELECT id, owner_id, document_id, title, source_path, preview_path, source_sha256, preview_sha256, source_size, preview_size, revision, created_at, updated_at, deleted_at, updated_by_device_id FROM drawings WHERE owner_id = ? AND deleted_at IS NULL ${documentId ? "AND document_id = ?" : ""} ORDER BY updated_at DESC`,
      ...(documentId ? [ownerId, documentId] : [ownerId]),
    );
    return rows.map(toDrawing);
  }

  public async save(
    drawing: Drawing,
    source: string,
    previewPath: string,
    deviceId: string,
  ): Promise<Drawing> {
    parseInk(source);
    const now = new Date().toISOString();
    const sourceFile = new File(
      new Directory(Paths.document, "drawings"),
      `${drawing.id}.stoneink`,
    );
    const sourceDirectory = new Directory(Paths.document, "drawings");
    sourceDirectory.create({ idempotent: true });
    sourceFile.write(serializeInk(parseInk(source)));
    const previewFile = new File(previewPath);
    const previewBytes = previewFile.exists ? await previewFile.bytes() : new Uint8Array();
    const sourceBytes = new TextEncoder().encode(sourceFile.textSync());
    const next: Drawing = {
      ...drawing,
      sourcePath: sourceFile.uri,
      previewPath,
      sourceSha256: await digest(sourceFile.textSync()),
      previewSha256: await digest(bytesToBase64(previewBytes)),
      sourceSize: sourceBytes.byteLength,
      previewSize: previewBytes.byteLength,
      revision: drawing.revision,
      updatedAt: now,
      updatedByDeviceId: deviceId,
    };
    await this.database.withTransactionAsync(async () => {
      await this.database.runAsync(
        "INSERT INTO drawings (id, owner_id, document_id, title, source_path, preview_path, source_sha256, preview_sha256, source_size, preview_size, revision, created_at, updated_at, deleted_at, updated_by_device_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET document_id = excluded.document_id, title = excluded.title, source_path = excluded.source_path, preview_path = excluded.preview_path, source_sha256 = excluded.source_sha256, preview_sha256 = excluded.preview_sha256, source_size = excluded.source_size, preview_size = excluded.preview_size, revision = excluded.revision, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at, updated_by_device_id = excluded.updated_by_device_id",
        next.id,
        next.ownerId,
        next.documentId,
        next.title,
        next.sourcePath,
        next.previewPath,
        next.sourceSha256,
        next.previewSha256,
        next.sourceSize,
        next.previewSize,
        next.revision,
        next.createdAt,
        next.updatedAt,
        next.deletedAt,
        next.updatedByDeviceId,
      );
      await this.database.runAsync(
        "INSERT INTO drawing_revisions (id, drawing_id, revision, source_path, preview_path, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        `${next.id}:${next.revision}`,
        next.id,
        next.revision,
        next.sourcePath,
        next.previewPath,
        next.updatedAt,
      );
      await enqueueOutbox(this.database, {
        ownerId: next.ownerId,
        entityType: "drawing",
        entityId: next.id,
        operation: next.deletedAt ? "delete" : "upsert",
        baseRevision: Math.max(0, next.revision - 1),
        revision: next.revision,
        payloadVersion: 1,
        payload: toDrawingPayload(next),
        createdAt: next.updatedAt,
        idempotencyKey: `${deviceId}:drawing:${next.id}:${next.revision}`,
      });
    });
    return next;
  }

  public async softDelete(ownerId: string, id: string, deviceId: string): Promise<Drawing> {
    const current = await this.getById(ownerId, id, true);
    if (!current) throw new Error("Drawing not found.");
    return this.save(
      { ...current, revision: current.revision + 1, deletedAt: new Date().toISOString() },
      new File(current.sourcePath).textSync(),
      current.previewPath,
      deviceId,
    );
  }

  public async revisions(ownerId: string, id: string): Promise<readonly DrawingRevision[]> {
    const rows = await this.database.getAllAsync<DrawingRevisionRow>(
      "SELECT r.id, r.drawing_id, r.revision, r.source_path, r.preview_path, r.created_at FROM drawing_revisions r JOIN drawings d ON d.id = r.drawing_id WHERE d.owner_id = ? AND d.id = ? ORDER BY r.revision DESC",
      ownerId,
      id,
    );
    return rows.map((row) => ({
      id: row.id,
      drawingId: row.drawing_id,
      revision: row.revision,
      sourcePath: row.source_path,
      previewPath: row.preview_path,
      createdAt: row.created_at,
    }));
  }
}

export function toDrawing(row: DrawingRow): Drawing {
  return {
    id: row.id,
    ownerId: row.owner_id,
    documentId: row.document_id,
    title: row.title,
    sourcePath: row.source_path,
    previewPath: row.preview_path,
    sourceSha256: row.source_sha256,
    previewSha256: row.preview_sha256,
    sourceSize: row.source_size,
    previewSize: row.preview_size,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    updatedByDeviceId: row.updated_by_device_id,
  };
}

export function toDrawingPayload(drawing: Drawing): Record<string, unknown> {
  return {
    id: drawing.id,
    ownerId: drawing.ownerId,
    documentId: drawing.documentId,
    title: drawing.title,
    sourcePath: drawing.sourcePath,
    previewPath: drawing.previewPath,
    sourceSha256: drawing.sourceSha256,
    previewSha256: drawing.previewSha256,
    sourceSize: drawing.sourceSize,
    previewSize: drawing.previewSize,
    revision: drawing.revision,
    createdAt: drawing.createdAt,
    updatedAt: drawing.updatedAt,
    deletedAt: drawing.deletedAt,
    updatedByDeviceId: drawing.updatedByDeviceId,
  };
}

async function digest(value: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
