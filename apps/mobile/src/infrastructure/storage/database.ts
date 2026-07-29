import * as SQLite from "expo-sqlite";
import { StorageError } from "@stone/domain";
import { assertSupportedMigrationVersion, migrations } from "./migrations";

export type StoneDatabase = SQLite.SQLiteDatabase;

export async function initializeDatabase(): Promise<StoneDatabase> {
  try {
    const database = await SQLite.openDatabaseAsync("stone.db");
    await database.execAsync("PRAGMA foreign_keys = ON;");
    const row = await database.getFirstAsync<{ user_version: number }>("PRAGMA user_version");
    let currentVersion = row?.user_version ?? 0;
    assertSupportedMigrationVersion(currentVersion);
    for (const migration of migrations) {
      if (migration.version <= currentVersion) continue;
      await database.withTransactionAsync(async () => {
        for (const statement of migration.statements) await database.execAsync(statement);
        await database.execAsync(`PRAGMA user_version = ${migration.version}`);
      });
      currentVersion = migration.version;
    }
    return database;
  } catch (error) {
    throw new StorageError(
      error instanceof Error ? error.message : "Yerel veritabanı başlatılamadı.",
    );
  }
}
