import { invoke } from "@tauri-apps/api/core";

export interface DesktopDocument {
  id: string;
  title: string;
  markdown: string;
  path: string | null;
  revision: number;
  updatedAt: string;
}

export interface FileFingerprint {
  sha256: string;
  modifiedMs: number;
  size: number;
}

export interface DesktopConfig {
  firebaseApiKey: string;
  firebaseProjectId: string;
  firebaseAuthDomain: string;
}

const environment = import.meta.env as unknown as Record<string, unknown>;
const environmentString = (key: string): string => {
  const value = environment[key];
  return typeof value === "string" ? value : "";
};

export const config: DesktopConfig = {
  firebaseApiKey: environmentString("VITE_FIREBASE_API_KEY"),
  firebaseProjectId: environmentString("VITE_FIREBASE_PROJECT_ID"),
  firebaseAuthDomain: environmentString("VITE_FIREBASE_AUTH_DOMAIN"),
};

export const isTauri = "__TAURI_INTERNALS__" in window;

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri) throw new Error("Bu özellik yalnızca Stone masaüstü uygulamasında kullanılabilir.");
  return invoke<T>(command, args);
}

export const desktopApi = {
  listDocuments: () => call<DesktopDocument[]>("list_documents"),
  getDocument: (id: string) => call<DesktopDocument | null>("get_document", { id }),
  saveDocument: (document: { id: string; title: string; markdown: string; path?: string | null }) =>
    call<DesktopDocument>("save_document", { document }),
  openMarkdownFile: (path: string) => call<DesktopDocument>("open_markdown_file", { path }),
  pickMarkdownFile: () => call<DesktopDocument | null>("pick_markdown_file"),
  pickFolder: () => call<string | null>("pick_folder"),
  indexFolder: (path: string) => call<DesktopDocument[]>("index_folder", { path }),
  loadLinkedFile: (path: string) =>
    call<{ path: string; markdown: string; fingerprint: FileFingerprint }>("load_linked_file", {
      path,
    }),
  saveLinkedFile: (path: string, markdown: string, expectedSha256: string) =>
    call<{ fingerprint: FileFingerprint }>("save_linked_file", {
      path,
      markdown,
      expectedSha256,
    }),
  watchFolder: (path: string) => call<void>("watch_folder", { path }),
  keychainGet: () => call<string | null>("keychain_get"),
  keychainSet: (refreshToken: string) => call<void>("keychain_set", { refreshToken }),
  keychainDelete: () => call<void>("keychain_delete"),
  openExternal: (target: "vscode" | "codex", path: string) =>
    call<void>("open_external", { target, path }),
  authSignIn: (email: string, password: string) =>
    call<AuthSession>("auth_sign_in", { apiKey: config.firebaseApiKey, email, password }),
  authRestore: () => call<AuthSession | null>("auth_restore", { apiKey: config.firebaseApiKey }),
  authPasswordReset: (email: string) =>
    call<void>("auth_password_reset", { apiKey: config.firebaseApiKey, email }),
  authSignOut: () => call<void>("auth_sign_out"),
  syncNow: () =>
    call<SyncSummary>("sync_now", {
      apiKey: config.firebaseApiKey,
      projectId: config.firebaseProjectId,
    }),
};

export interface AuthSession {
  uid: string;
  email: string;
  idToken: string;
  expiresAt: number;
}

export interface SyncSummary {
  pushed: number;
  pulled: number;
  conflicts: number;
  offline: boolean;
}
