import type { UserSettings, SettingsRepository } from "@stone/domain";
import { validateSettings } from "@stone/domain";
import type { StoneDatabase } from "./database";
import { enqueueOutbox } from "./sync";

export class SQLiteSettingsRepository implements SettingsRepository {
  public constructor(private readonly database: StoneDatabase) {}

  public async get(ownerId: string): Promise<UserSettings> {
    const row = await this.database.getFirstAsync<{
      owner_id: string;
      theme: string;
      reduce_motion: number;
      editor_font_size: number;
      trash_retention_days: number;
      revision: number;
    }>(
      "SELECT owner_id, theme, reduce_motion, editor_font_size, trash_retention_days, revision FROM settings WHERE owner_id = ?",
      ownerId,
    );
    const settings: UserSettings = row
      ? {
          ownerId: row.owner_id,
          theme: row.theme as UserSettings["theme"],
          reduceMotion: row.reduce_motion === 1,
          editorFontSize: row.editor_font_size,
          trashRetentionDays: row.trash_retention_days,
        }
      : {
          ownerId,
          theme: "system",
          reduceMotion: false,
          editorFontSize: 17,
          trashRetentionDays: 30,
        };
    return validateSettings(settings);
  }

  public async save(settings: UserSettings): Promise<void> {
    const valid = validateSettings(settings);
    await this.database.withTransactionAsync(async () => {
      const current = await this.database.getFirstAsync<{ revision: number }>(
        "SELECT revision FROM settings WHERE owner_id = ?",
        valid.ownerId,
      );
      const revision = (current?.revision ?? 0) + 1;
      await this.database.runAsync(
        "INSERT INTO settings (owner_id, theme, reduce_motion, editor_font_size, trash_retention_days, revision) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(owner_id) DO UPDATE SET theme = excluded.theme, reduce_motion = excluded.reduce_motion, editor_font_size = excluded.editor_font_size, trash_retention_days = excluded.trash_retention_days, revision = excluded.revision",
        valid.ownerId,
        valid.theme,
        valid.reduceMotion ? 1 : 0,
        valid.editorFontSize,
        valid.trashRetentionDays,
        revision,
      );
      await enqueueOutbox(this.database, {
        ownerId: valid.ownerId,
        entityType: "settings",
        entityId: valid.ownerId,
        operation: "upsert",
        baseRevision: revision - 1,
        revision,
        payloadVersion: 1,
        payload: { ...valid, id: valid.ownerId, revision },
        createdAt: new Date().toISOString(),
        idempotencyKey: `${valid.ownerId}:settings:${revision}`,
      });
    });
  }
}
