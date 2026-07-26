export type DocumentKind =
  "note" | "project" | "version" | "decision_log" | "inbox" | "release_checklist";

export type ProjectStatus =
  | "idea"
  | "planning"
  | "development"
  | "testing"
  | "store_process"
  | "live"
  | "update_needed"
  | "maintenance"
  | "paused"
  | "archived";

export type ProjectPriority = "low" | "medium" | "high" | "critical";
export type ThemePreference = "system" | "light" | "dark";

export interface SyncFields {
  id: string;
  ownerId: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  updatedByDeviceId: string;
}

export interface Document extends SyncFields {
  kind: DocumentKind;
  title: string;
  markdown: string;
  path: string | null;
  projectId: string | null;
  isPinned: boolean;
}

export interface Device {
  id: string;
  ownerId: string;
  platform: "android" | "ios" | "windows";
  name: string;
  appVersion: string;
  lastSeenAt: string;
}

export interface UserSettings {
  ownerId: string;
  theme: ThemePreference;
  reduceMotion: boolean;
  editorFontSize: number;
  trashRetentionDays: number;
}

export interface Repository<T> {
  getById(id: string): Promise<T | null>;
  list(): Promise<readonly T[]>;
}

export interface SettingsRepository {
  get(ownerId: string): Promise<UserSettings>;
  save(settings: UserSettings): Promise<void>;
}

export interface DeviceRepository {
  getOrCreate(input: Omit<Device, "lastSeenAt">): Promise<Device>;
  touch(id: string, lastSeenAt: string): Promise<void>;
}

export type DocumentRepository = Repository<Document>;
