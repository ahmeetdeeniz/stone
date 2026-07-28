import type { StoneDatabase } from "./database";

export class SQLitePrivacyRepository {
  public constructor(private readonly database: StoneDatabase) {}

  public async purgeOwner(ownerId: string): Promise<void> {
    await this.database.withTransactionAsync(async () => {
      for (const table of [
        "documents_fts",
        "document_drafts",
        "tasks_index",
        "task_occurrences",
        "tasks",
        "calendar_items",
        "project_blockers",
        "projects",
        "versions",
        "conflicts",
        "outbox",
        "sync_state_cursors",
        "sync_state",
        "settings",
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
      await this.database.runAsync("DELETE FROM users WHERE id = ?", ownerId);
    });
  }
}
