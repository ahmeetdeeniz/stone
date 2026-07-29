import { File } from "expo-file-system";
import type { StoneDatabase } from "./database";

export class SQLitePrivacyRepository {
  public constructor(private readonly database: StoneDatabase) {}

  public async purgeOwner(ownerId: string): Promise<void> {
    const drawingFiles = await this.database.getAllAsync<{ path: string }>(
      `SELECT source_path AS path FROM drawings WHERE owner_id = ?
       UNION
       SELECT preview_path AS path FROM drawings WHERE owner_id = ?
       UNION
       SELECT r.source_path AS path FROM drawing_revisions r
         JOIN drawings d ON d.id = r.drawing_id WHERE d.owner_id = ?
       UNION
       SELECT r.preview_path AS path FROM drawing_revisions r
         JOIN drawings d ON d.id = r.drawing_id WHERE d.owner_id = ?`,
      ownerId,
      ownerId,
      ownerId,
      ownerId,
    );
    for (const row of drawingFiles) {
      const file = new File(row.path);
      if (file.exists) file.delete();
    }
    await this.database.withTransactionAsync(async () => {
      await this.database.runAsync(
        "DELETE FROM project_tags WHERE project_id IN (SELECT id FROM projects WHERE owner_id = ?)",
        ownerId,
      );
      for (const table of [
        "documents_fts",
        "document_drafts",
        "tasks_index",
        "task_occurrences",
        "tasks",
        "calendar_items",
        "focus_sessions",
        "focus_goals",
        "project_blockers",
        "projects",
        "versions",
        "conflicts",
        "outbox",
        "sync_state_cursors",
        "sync_state",
        "settings",
        "tags",
        "workspaces",
        "devices",
      ]) {
        await this.database.runAsync(`DELETE FROM ${table} WHERE owner_id = ?`, ownerId);
      }
      await this.database.runAsync(
        "DELETE FROM document_revisions WHERE document_id IN (SELECT id FROM documents WHERE owner_id = ?)",
        ownerId,
      );
      await this.database.runAsync("DELETE FROM documents WHERE owner_id = ?", ownerId);
      await this.database.runAsync(
        "DELETE FROM drawing_revisions WHERE drawing_id IN (SELECT id FROM drawings WHERE owner_id = ?)",
        ownerId,
      );
      await this.database.runAsync("DELETE FROM drawings WHERE owner_id = ?", ownerId);
      await this.database.runAsync("DELETE FROM sync_cursors");
      await this.database.runAsync("DELETE FROM users WHERE id = ?", ownerId);
    });
  }
}
