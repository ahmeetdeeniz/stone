import type { AttachmentUploadQueue } from "../../attachments/attachment-service";
import type { StoneDatabase } from "./database";

export class SQLiteAttachmentUploadQueue implements AttachmentUploadQueue {
  public constructor(private readonly database: StoneDatabase) {}

  public async enqueue(ownerId: string, fileName: string): Promise<void> {
    // An already uploaded file stays uploaded: names are content hashes, so it is the same file.
    await this.database.runAsync(
      "INSERT INTO attachment_uploads (owner_id, file_name, state, attempts, last_error, updated_at) VALUES (?, ?, 'pending', 0, NULL, ?) ON CONFLICT(owner_id, file_name) DO NOTHING",
      ownerId,
      fileName,
      new Date().toISOString(),
    );
  }

  public async pending(ownerId: string, limit: number): Promise<readonly string[]> {
    const rows = await this.database.getAllAsync<{ file_name: string }>(
      "SELECT file_name FROM attachment_uploads WHERE owner_id = ? AND state = 'pending' ORDER BY attempts, updated_at LIMIT ?",
      ownerId,
      limit,
    );
    return rows.map((row) => row.file_name);
  }

  public async markUploaded(ownerId: string, fileName: string): Promise<void> {
    await this.database.runAsync(
      "UPDATE attachment_uploads SET state = 'uploaded', last_error = NULL, updated_at = ? WHERE owner_id = ? AND file_name = ?",
      new Date().toISOString(),
      ownerId,
      fileName,
    );
  }

  public async markFailed(ownerId: string, fileName: string, error: string): Promise<void> {
    await this.database.runAsync(
      "UPDATE attachment_uploads SET attempts = attempts + 1, last_error = ?, updated_at = ? WHERE owner_id = ? AND file_name = ?",
      error.slice(0, 500),
      new Date().toISOString(),
      ownerId,
      fileName,
    );
  }

  public async pendingCount(ownerId: string): Promise<number> {
    const row = await this.database.getFirstAsync<{ count: number }>(
      "SELECT COUNT(*) AS count FROM attachment_uploads WHERE owner_id = ? AND state = 'pending'",
      ownerId,
    );
    return row?.count ?? 0;
  }
}
