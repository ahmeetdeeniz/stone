import type { SettingsRepository } from "@stone/domain";
import { initializeDatabase, type StoneDatabase } from "../infrastructure/storage/database";
import { SQLiteSettingsRepository } from "../infrastructure/storage/repositories";
import { SQLiteDeviceRepository, createDeviceIdentity } from "../infrastructure/storage/device";

export interface AppServices {
  database: StoneDatabase;
  settings: SettingsRepository;
  device: SQLiteDeviceRepository;
}

export async function createAppServices(): Promise<AppServices> {
  const database = await initializeDatabase();
  const settings = new SQLiteSettingsRepository(database);
  const device = new SQLiteDeviceRepository(database);
  await device.getOrCreate(createDeviceIdentity());
  return { database, settings, device };
}
