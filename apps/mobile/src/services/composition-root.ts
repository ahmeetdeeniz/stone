import {
  NoteUseCases,
  ProjectUseCases,
  SettingsUseCases,
  TaskUseCases,
  type SettingsRepository,
  type ExportedProjectFile,
} from "@stone/domain";
import { initializeDatabase, type StoneDatabase } from "../infrastructure/storage/database";
import { SQLiteNoteRepository } from "../infrastructure/storage/notes";
import { SQLiteSettingsRepository } from "../infrastructure/storage/repositories";
import { SQLiteProjectRepository } from "../infrastructure/storage/projects";
import { SQLiteDeviceRepository, createDeviceIdentity } from "../infrastructure/storage/device";
import { SQLiteSyncStore } from "../infrastructure/storage/sync";
import { FirebaseSyncRemote } from "../infrastructure/firebase/firestore";
import { SyncEngine, type SyncRunResult } from "@stone/sync";
import { SQLitePrivacyRepository } from "../infrastructure/storage/privacy";
import {
  exportWorkspace,
  notebookAttachmentFiles,
} from "../infrastructure/storage/workspace-export";
import { File } from "expo-file-system";
import { SQLiteDrawingRepository } from "../infrastructure/storage/drawings";
import { SQLiteAttachmentUploadQueue } from "../infrastructure/storage/attachments";
import { FirebaseAttachmentStorage } from "../infrastructure/firebase/attachment-storage";
import { AttachmentService } from "../attachments/attachment-service";
import { referencedAttachmentFiles } from "@stone/markdown";
import { expoAttachmentFiles } from "../attachments/expo-attachment-files";
import { SQLiteTaskRepository } from "../infrastructure/storage/tasks";
import { SQLiteCalendarRepository } from "../infrastructure/storage/calendar";
import { SQLiteFocusRepository } from "../infrastructure/storage/focus";

export interface AppServices {
  database: StoneDatabase;
  settings: SettingsRepository;
  settingsUseCases: SettingsUseCases;
  notes: SQLiteNoteRepository;
  noteUseCases: NoteUseCases;
  projects: SQLiteProjectRepository;
  projectUseCases: ProjectUseCases;
  tasks: SQLiteTaskRepository;
  calendar: SQLiteCalendarRepository;
  focus: SQLiteFocusRepository;
  taskUseCases: TaskUseCases;
  drawings: SQLiteDrawingRepository;
  attachments: AttachmentService;
  device: SQLiteDeviceRepository;
  deviceId: string;
  syncStore: SQLiteSyncStore;
  sync(ownerId: string): Promise<SyncRunResult>;
  deleteRemoteData(ownerId: string): Promise<void>;
  purgeLocalData(ownerId: string): Promise<void>;
  exportWorkspace(ownerId: string): Promise<readonly ExportedProjectFile[]>;
}

let sharedServices: Promise<AppServices> | null = null;

/**
 * Returns the process-wide services, creating them at most once. Every caller
 * (UI, background task) shares one database connection; concurrent
 * initialisation would interleave migration transactions on that connection.
 * A failed attempt is forgotten so the next call can retry.
 */
export function getAppServices(): Promise<AppServices> {
  sharedServices ??= createAppServices().catch((error: unknown) => {
    sharedServices = null;
    throw error;
  });
  return sharedServices;
}

async function createAppServices(): Promise<AppServices> {
  const database = await initializeDatabase();
  const settings = new SQLiteSettingsRepository(database);
  const settingsUseCases = new SettingsUseCases(settings);
  const notes = new SQLiteNoteRepository(database);
  const noteUseCases = new NoteUseCases(notes);
  const projects = new SQLiteProjectRepository(database);
  const projectUseCases = new ProjectUseCases(projects);
  const tasks = new SQLiteTaskRepository(database);
  const calendar = new SQLiteCalendarRepository(database);
  const focus = new SQLiteFocusRepository(database);
  const taskUseCases = new TaskUseCases(tasks);
  const drawings = new SQLiteDrawingRepository(database);
  const device = new SQLiteDeviceRepository(database);
  const deviceIdentity = await createDeviceIdentity();
  await device.getOrCreate(deviceIdentity);
  const syncStore = new SQLiteSyncStore(database);
  const privacy = new SQLitePrivacyRepository(database);
  const attachments = new AttachmentService(
    expoAttachmentFiles,
    new FirebaseAttachmentStorage(),
    new SQLiteAttachmentUploadQueue(database),
  );
  // Auth changes, app resume, widgets and the background task can all request a sync at once;
  // callers for the same owner share the in-flight run instead of pushing the outbox twice.
  const inFlight = new Map<string, Promise<SyncRunResult>>();
  const sync = (ownerId: string): Promise<SyncRunResult> => {
    const running = inFlight.get(ownerId);
    if (running) return running;
    const run = runSync(ownerId).finally(() => inFlight.delete(ownerId));
    inFlight.set(ownerId, run);
    return run;
  };
  const runSync = async (ownerId: string): Promise<SyncRunResult> => {
    const engine = new SyncEngine(new FirebaseSyncRemote(), syncStore, {
      onStatus: (status) => {
        void syncStore.setState(ownerId, {
          status,
          lastError: null,
          updatedAt: new Date().toISOString(),
        });
      },
    });
    try {
      const result = await engine.run(ownerId);
      // Attachment uploads ride along with every sync; a failed upload stays queued and must
      // not fail the sync of the notes themselves.
      await attachments.flush(ownerId).catch(() => undefined);
      return result;
    } catch (error) {
      await syncStore.setState(ownerId, {
        status: "error",
        lastError: error instanceof Error ? error.message : "Sync failed.",
        updatedAt: new Date().toISOString(),
      });
      throw error;
    }
  };
  const deleteRemoteData = (ownerId: string) => new FirebaseSyncRemote().deleteOwnerData(ownerId);
  return {
    database,
    settings,
    settingsUseCases,
    notes,
    noteUseCases,
    projects,
    projectUseCases,
    tasks,
    calendar,
    focus,
    taskUseCases,
    drawings,
    attachments,
    device,
    deviceId: deviceIdentity.id,
    syncStore,
    sync,
    deleteRemoteData,
    purgeLocalData: (ownerId) => privacy.purgeOwner(ownerId),
    exportWorkspace: async (ownerId) => {
      // Best effort: fetch attachments this device has not opened yet so the export is complete.
      const rows = await database.getAllAsync<{ markdown: string }>(
        "SELECT markdown FROM documents WHERE owner_id = ? AND deleted_at IS NULL",
        ownerId,
      );
      const referenced = new Set(rows.flatMap((row) => referencedAttachmentFiles(row.markdown)));
      for (const drawing of await drawings.list(ownerId)) {
        const source = new File(drawing.sourcePath);
        if (source.exists)
          for (const fileName of notebookAttachmentFiles(await source.text()))
            referenced.add(fileName);
      }
      for (const fileName of referenced)
        await attachments.resolve(ownerId, fileName).catch(() => undefined);
      return exportWorkspace(database, ownerId);
    },
  };
}
