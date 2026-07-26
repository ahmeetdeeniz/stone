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
  githubClientId: string;
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
  githubClientId: environmentString("VITE_GITHUB_CLIENT_ID"),
};

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

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
  githubDeviceStart: () =>
    call<GitHubDeviceStart>("github_device_start", { clientId: config.githubClientId }),
  githubDevicePoll: (deviceCode: string) =>
    call<GitHubDevicePoll>("github_device_poll", {
      clientId: config.githubClientId,
      deviceCode,
    }),
  githubStatus: () => call<GitHubAccount | null>("github_status"),
  githubDisconnect: () => call<void>("github_disconnect"),
  githubListRepositories: (page: number) =>
    call<GitHubRepositoryPage>("github_list_repositories", { page }),
  githubLinkRepository: (
    projectId: string,
    repository: GitHubRepository,
    localPath?: string | null,
  ) =>
    call<GitHubLink>("github_link_repository", {
      input: { projectId, repository, localPath: localPath ?? null },
    }),
  githubListLinks: () => call<GitHubLink[]>("github_list_links"),
  gitSystemVersion: () => call<string>("git_system_version"),
  gitStatus: (path: string) => call<GitStatus>("git_status", { path }),
  gitReview: (path: string) => call<GitReview>("git_review", { path }),
  gitPull: (path: string) => call<GitOperationResult>("git_pull", { path }),
  gitStageCommitPush: (path: string, paths: string[], message: string) =>
    call<GitOperationResult>("git_stage_commit_push", { path, paths, message }),
  gitClone: (root: string, fullName: string, sizeKb: number) =>
    call<GitOperationResult>("git_clone", { root, fullName, sizeKb }),
  restoreDiskCheck: (root: string, repositories: RestoreRepositoryInput[]) =>
    call<number>("restore_disk_check", { root, repositories }),
  restoreRepositories: (runId: string, root: string, repositories: RestoreRepositoryInput[]) =>
    call<RestoreSummary>("restore_repositories", { runId, root, repositories }),
  cancelRestore: (runId: string) => call<void>("cancel_restore", { runId }),
  openExternalPath: (target: "vscode" | "codex", path: string) =>
    call<void>("open_external_path", { target, path }),
  openGithubUrl: (url: string) => call<void>("open_github_url", { url }),
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

export interface GitHubAccount {
  id: number;
  login: string;
  name: string | null;
  avatarUrl: string;
}

export interface GitHubDeviceStart {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

export interface GitHubDevicePoll {
  status: "pending" | "slow_down" | "authorized" | "denied" | "expired";
  interval: number;
  account: GitHubAccount | null;
}

export interface GitHubRepository {
  id: number;
  name: string;
  fullName: string;
  private: boolean;
  htmlUrl: string;
  cloneUrl: string;
  sshUrl: string;
  sizeKb: number;
  defaultBranch: string;
  visibility: string | null;
  updatedAt: string;
  permissions: { admin: boolean; push: boolean; pull: boolean } | null;
}

export interface GitHubRepositoryPage {
  page: number;
  repositories: GitHubRepository[];
  hasNext: boolean;
}

export interface GitStatus {
  path: string;
  branch: string | null;
  isDirty: boolean;
  entries: string[];
  lfs: { installed: boolean; trackedFiles: number; warning: string | null };
}

export interface GitReview {
  status: GitStatus;
  staged: string[];
  diffStat: string;
}

export interface GitOperationResult {
  output: string;
  warnings: string[];
}

export interface GitHubLink {
  projectId: string;
  repository: GitHubRepository;
  localPath: string | null;
  updatedAt: string;
}

export interface RestoreRepositoryInput {
  fullName: string;
  sizeKb: number;
}

export interface RestoreItemResult {
  fullName: string;
  status: "cloned" | "failed" | "cancelled";
  path: string | null;
  error: string | null;
  warnings: string[];
}

export interface RestoreSummary {
  runId: string;
  cancelled: boolean;
  results: RestoreItemResult[];
}
