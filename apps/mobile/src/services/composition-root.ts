import { SettingsUseCases, type SettingsRepository } from "@stone/domain";
import { initializeDatabase, type StoneDatabase } from "../infrastructure/storage/database";
import { SQLiteSettingsRepository } from "../infrastructure/storage/repositories";
import { SQLiteDeviceRepository, createDeviceIdentity } from "../infrastructure/storage/device";

export interface AppServices {
  database: StoneDatabase;
  settings: SettingsRepository;
  settingsUseCases: SettingsUseCases;
  device: SQLiteDeviceRepository;
  deviceId: string;
}

export async function createAppServices(): Promise<AppServices> {
  const database = await initializeDatabase();
  const settings = new SQLiteSettingsRepository(database);
  const settingsUseCases = new SettingsUseCases(settings);
  const device = new SQLiteDeviceRepository(database);
  const deviceIdentity = await createDeviceIdentity();
  await device.getOrCreate(deviceIdentity);
  return { database, settings, settingsUseCases, device, deviceId: deviceIdentity.id };
}
