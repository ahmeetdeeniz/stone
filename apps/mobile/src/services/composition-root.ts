import { NoteUseCases, SettingsUseCases, type SettingsRepository } from "@stone/domain";
import { initializeDatabase, type StoneDatabase } from "../infrastructure/storage/database";
import { SQLiteNoteRepository } from "../infrastructure/storage/notes";
import { SQLiteSettingsRepository } from "../infrastructure/storage/repositories";
import { SQLiteDeviceRepository, createDeviceIdentity } from "../infrastructure/storage/device";

export interface AppServices {
  database: StoneDatabase;
  settings: SettingsRepository;
  settingsUseCases: SettingsUseCases;
  notes: SQLiteNoteRepository;
  noteUseCases: NoteUseCases;
  device: SQLiteDeviceRepository;
  deviceId: string;
}

export async function createAppServices(): Promise<AppServices> {
  const database = await initializeDatabase();
  const settings = new SQLiteSettingsRepository(database);
  const settingsUseCases = new SettingsUseCases(settings);
  const notes = new SQLiteNoteRepository(database);
  const noteUseCases = new NoteUseCases(notes);
  const device = new SQLiteDeviceRepository(database);
  const deviceIdentity = await createDeviceIdentity();
  await device.getOrCreate(deviceIdentity);
  return {
    database,
    settings,
    settingsUseCases,
    notes,
    noteUseCases,
    device,
    deviceId: deviceIdentity.id,
  };
}
