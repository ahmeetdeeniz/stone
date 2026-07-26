import type {
  Document,
  DocumentKind,
  DocumentRevision,
  NoteDraft,
  NoteListOptions,
  NoteRepository,
} from "@stone/domain";
import { StorageError } from "@stone/domain";
import { normalizeMarkdown } from "@stone/markdown";
import type { StoneDatabase } from "./database";

interface DocumentRow {
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
  updated_at: string;
  deleted_at: string | null;
  updated_by_device_id: string;
}

interface RevisionRow {
  id: string;
  document_id: string;
  revision: number;
  markdown: string;
  created_at: string;
}

interface DraftRow {
  document_id: string;
  owner_id: string;
  markdown: string;
  updated_at: string;
  selection_from: number;
  selection_to: number;
}

export class SQLiteNoteRepository implements NoteRepository {
  public constructor(private readonly database: StoneDatabase) {}

  public create(document: Document): Promise<Document> {
    return withStorageError(async () => {
      const markdown = normalizeMarkdown(document.markdown);
      await this.database.withTransactionAsync(async () => {
        await this.database.runAsync(
          "INSERT INTO documents (id, owner_id, kind, title, markdown, path, project_id, is_pinned, revision, created_at, updated_at, deleted_at, updated_by_device_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          document.id,
          document.ownerId,
          document.kind,
          document.title.trim(),
          markdown,
          document.path,
          document.projectId,
          document.isPinned ? 1 : 0,
          document.revision,
          document.createdAt,
          document.updatedAt,
          document.deletedAt,
          document.updatedByDeviceId,
        );
        await this.insertRevision(document.id, document.revision, markdown, document.updatedAt);
        await this.replaceSearchIndex({ ...document, markdown });
      });
      return { ...document, title: document.title.trim(), markdown };
    });
  }

  public getById(ownerId: string, id: string, includeDeleted = false): Promise<Document | null> {
    return withStorageError(async () => {
      const row = await this.database.getFirstAsync<DocumentRow>(
        `SELECT id, owner_id, kind, title, markdown, path, project_id, is_pinned, revision, created_at, updated_at, deleted_at, updated_by_device_id
         FROM documents WHERE owner_id = ? AND id = ? ${includeDeleted ? "" : "AND deleted_at IS NULL"}`,
        ownerId,
        id,
      );
      return row ? toDocument(row) : null;
    });
  }

  public list(ownerId: string, options: NoteListOptions = {}): Promise<readonly Document[]> {
    return withStorageError(async () => {
      const includeDeleted = options.includeDeleted === true;
      const pinnedOnly = options.pinnedOnly === true;
      const searchQuery = buildSearchQuery(options.search);
      const limit = Math.max(1, Math.min(options.limit ?? 200, 500));
      const base = `
        SELECT d.id, d.owner_id, d.kind, d.title, d.markdown, d.path, d.project_id, d.is_pinned, d.revision,
               d.created_at, d.updated_at, d.deleted_at, d.updated_by_device_id
        FROM documents d
        ${searchQuery ? "JOIN documents_fts f ON f.document_id = d.id" : ""}
        WHERE d.owner_id = ?
        ${includeDeleted ? "AND d.deleted_at IS NOT NULL" : "AND d.deleted_at IS NULL"}
        ${pinnedOnly ? "AND d.is_pinned = 1" : ""}
        ${searchQuery ? "AND f.documents_fts MATCH ?" : ""}
        ORDER BY d.is_pinned DESC, d.updated_at DESC
        LIMIT ?`;
      const args: (string | number)[] = [ownerId];
      if (searchQuery) args.push(searchQuery);
      args.push(limit);
      const rows = await this.database.getAllAsync<DocumentRow>(base, ...args);
      return rows.map(toDocument);
    });
  }

  public updateMarkdown(
    ownerId: string,
    id: string,
    markdown: string,
    deviceId: string,
  ): Promise<Document> {
    return this.update(ownerId, id, { markdown: normalizeMarkdown(markdown) }, deviceId);
  }

  public rename(ownerId: string, id: string, title: string, deviceId: string): Promise<Document> {
    return this.update(ownerId, id, { title: title.trim() }, deviceId);
  }

  public setPinned(
    ownerId: string,
    id: string,
    pinned: boolean,
    deviceId: string,
  ): Promise<Document> {
    return this.update(ownerId, id, { isPinned: pinned }, deviceId);
  }

  public softDelete(ownerId: string, id: string, deviceId: string): Promise<Document> {
    return this.update(ownerId, id, { deletedAt: new Date().toISOString() }, deviceId);
  }

  public restore(ownerId: string, id: string, deviceId: string): Promise<Document> {
    return this.update(ownerId, id, { deletedAt: null }, deviceId);
  }

  public permanentlyDelete(ownerId: string, id: string): Promise<void> {
    return withStorageError(async () => {
      await this.database.withTransactionAsync(async () => {
        await this.database.runAsync("DELETE FROM documents_fts WHERE document_id = ?", id);
        await this.database.runAsync(
          "DELETE FROM document_drafts WHERE owner_id = ? AND document_id = ?",
          ownerId,
          id,
        );
        await this.database.runAsync(
          "DELETE FROM document_revisions WHERE document_id = ? AND EXISTS (SELECT 1 FROM documents WHERE id = ? AND owner_id = ?)",
          id,
          id,
          ownerId,
        );
        await this.database.runAsync(
          "DELETE FROM documents WHERE owner_id = ? AND id = ?",
          ownerId,
          id,
        );
      });
    });
  }

  public revisions(ownerId: string, id: string): Promise<readonly DocumentRevision[]> {
    return withStorageError(async () => {
      const rows = await this.database.getAllAsync<RevisionRow>(
        "SELECT r.id, r.document_id, r.revision, r.markdown, r.created_at FROM document_revisions r JOIN documents d ON d.id = r.document_id WHERE d.owner_id = ? AND d.id = ? ORDER BY r.revision DESC",
        ownerId,
        id,
      );
      return rows.map((row) => ({
        id: row.id,
        documentId: row.document_id,
        revision: row.revision,
        markdown: row.markdown,
        createdAt: row.created_at,
      }));
    });
  }

  public async restoreRevision(
    ownerId: string,
    id: string,
    revision: number,
    deviceId: string,
  ): Promise<Document> {
    const rows = await this.revisions(ownerId, id);
    const target = rows.find((item) => item.revision === revision);
    if (!target) throw new StorageError("Revision not found.");
    return this.updateMarkdown(ownerId, id, target.markdown, deviceId);
  }

  public getDraft(ownerId: string, documentId: string): Promise<NoteDraft | null> {
    return withStorageError(async () => {
      const row = await this.database.getFirstAsync<DraftRow>(
        "SELECT document_id, owner_id, markdown, updated_at, selection_from, selection_to FROM document_drafts WHERE owner_id = ? AND document_id = ?",
        ownerId,
        documentId,
      );
      return row
        ? {
            documentId: row.document_id,
            ownerId: row.owner_id,
            markdown: row.markdown,
            updatedAt: row.updated_at,
            selectionFrom: row.selection_from,
            selectionTo: row.selection_to,
          }
        : null;
    });
  }

  public saveDraft(draft: NoteDraft): Promise<void> {
    return withStorageError(async () => {
      await this.database.runAsync(
        "INSERT INTO document_drafts (document_id, owner_id, markdown, updated_at, selection_from, selection_to) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(document_id) DO UPDATE SET owner_id = excluded.owner_id, markdown = excluded.markdown, updated_at = excluded.updated_at, selection_from = excluded.selection_from, selection_to = excluded.selection_to",
        draft.documentId,
        draft.ownerId,
        normalizeMarkdown(draft.markdown),
        draft.updatedAt,
        draft.selectionFrom,
        draft.selectionTo,
      );
    });
  }

  public clearDraft(ownerId: string, documentId: string): Promise<void> {
    return withStorageError(async () => {
      await this.database.runAsync(
        "DELETE FROM document_drafts WHERE owner_id = ? AND document_id = ?",
        ownerId,
        documentId,
      );
    });
  }

  private async update(
    ownerId: string,
    id: string,
    changes: Partial<Pick<Document, "markdown" | "title" | "isPinned" | "deletedAt">>,
    deviceId: string,
  ): Promise<Document> {
    return withStorageError(async () => {
      let updated: Document | null = null;
      await this.database.withTransactionAsync(async () => {
        const row = await this.database.getFirstAsync<DocumentRow>(
          "SELECT id, owner_id, kind, title, markdown, path, project_id, is_pinned, revision, created_at, updated_at, deleted_at, updated_by_device_id FROM documents WHERE owner_id = ? AND id = ?",
          ownerId,
          id,
        );
        if (!row) throw new StorageError("Note not found.");
        const current = toDocument(row);
        const now = new Date().toISOString();
        const next: Document = {
          ...current,
          markdown: changes.markdown ?? current.markdown,
          title: changes.title ?? current.title,
          isPinned: changes.isPinned ?? current.isPinned,
          deletedAt: changes.deletedAt === undefined ? current.deletedAt : changes.deletedAt,
          revision: current.revision + 1,
          updatedAt: now,
          updatedByDeviceId: deviceId,
        };
        await this.database.runAsync(
          "UPDATE documents SET title = ?, markdown = ?, is_pinned = ?, revision = ?, updated_at = ?, deleted_at = ?, updated_by_device_id = ? WHERE owner_id = ? AND id = ?",
          next.title,
          next.markdown,
          next.isPinned ? 1 : 0,
          next.revision,
          next.updatedAt,
          next.deletedAt,
          next.updatedByDeviceId,
          ownerId,
          id,
        );
        await this.insertRevision(id, next.revision, next.markdown, now);
        await this.replaceSearchIndex(next);
        updated = next;
      });
      if (!updated) throw new StorageError("Note update did not complete.");
      return updated;
    });
  }

  private insertRevision(
    documentId: string,
    revision: number,
    markdown: string,
    createdAt: string,
  ): Promise<void> {
    return this.database
      .runAsync(
        "INSERT INTO document_revisions (id, document_id, revision, markdown, created_at) VALUES (?, ?, ?, ?, ?)",
        `${documentId}:${revision}`,
        documentId,
        revision,
        markdown,
        createdAt,
      )
      .then(() => undefined);
  }

  private async replaceSearchIndex(document: Document): Promise<void> {
    await this.database.runAsync("DELETE FROM documents_fts WHERE document_id = ?", document.id);
    if (!document.deletedAt) {
      await this.database.runAsync(
        "INSERT INTO documents_fts (document_id, owner_id, title, markdown) VALUES (?, ?, ?, ?)",
        document.id,
        document.ownerId,
        document.title,
        document.markdown,
      );
    }
  }
}

function toDocument(row: DocumentRow): Document {
  return {
    id: row.id,
    ownerId: row.owner_id,
    kind: row.kind as DocumentKind,
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

function buildSearchQuery(value: string | undefined): string | null {
  const terms = value
    ?.trim()
    .replace(/["*:()[\]]/gu, " ")
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 8);
  return terms && terms.length > 0 ? terms.map((term) => `"${term}"*`).join(" AND ") : null;
}

async function withStorageError<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof StorageError) throw error;
    throw new StorageError(error instanceof Error ? error.message : "Local note storage failed.");
  }
}
