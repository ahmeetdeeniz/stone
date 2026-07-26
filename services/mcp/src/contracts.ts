export const SCOPES = [
  "stone.read.notes",
  "stone.read.projects",
  "stone.read.tasks",
  "stone.write.notes",
  "stone.write.projects",
  "stone.write.tasks",
] as const;

export type StoneScope = (typeof SCOPES)[number];

export interface AuthContext {
  userId: string;
  clientId: string;
  scopes: readonly StoneScope[];
}

export interface DocumentRecord {
  id: string;
  ownerId: string;
  kind: string;
  title: string;
  markdown: string;
  path: string | null;
  projectId: string | null;
  isPinned: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  updatedByDeviceId: string;
  [key: string]: unknown;
}

export interface ProjectRecord {
  id: string;
  ownerId: string;
  canonicalDocumentId: string;
  title: string;
  slug: string;
  status: string;
  priority: string;
  tags: string[];
  targetDate: string | null;
  currentVersion: string | null;
  nextVersion: string | null;
  nextAction: string | null;
  repositoryUrl: string | null;
  platforms: string[];
  health: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  updatedByDeviceId: string;
  [key: string]: unknown;
}

export interface VersionRecord {
  id: string;
  ownerId: string;
  projectId: string;
  canonicalDocumentId: string;
  version: string;
  status: string;
  targetDate: string | null;
  androidStatus: string;
  iosStatus: string;
  completedTasks: number;
  totalTasks: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  updatedByDeviceId: string;
  [key: string]: unknown;
}

export interface Page<T> {
  items: readonly T[];
  nextPageToken: string | null;
}

export interface ListDocumentsOptions {
  kind?: string;
  projectId?: string | undefined;
  includeDeleted?: boolean | undefined;
  cursorKey?: string | undefined;
  pageToken?: string | undefined;
  limit: number;
}

export interface ListProjectsOptions {
  status?: string | undefined;
  tag?: string | undefined;
  priority?: string | undefined;
  health?: string | undefined;
  cursorKey?: string | undefined;
  pageToken?: string | undefined;
  limit: number;
}

export interface ListVersionsOptions {
  projectId?: string | undefined;
  cursorKey?: string | undefined;
  pageToken?: string | undefined;
  limit: number;
}

export interface AuditEntry {
  id: string;
  ownerId: string;
  tool: string;
  inputSummary: Record<string, unknown>;
  affectedEntities: readonly string[];
  beforeRevision: number | null;
  afterRevision: number | null;
  confirmation: Record<string, unknown> | null;
  createdAt: string;
}

export interface StoredIdempotencyResult {
  idempotencyKey: string;
  tool: string;
  result: Record<string, unknown>;
  createdAt: string;
}

export interface DocumentWriteInput {
  ownerId: string;
  documentId: string;
  expectedRevision: number;
  idempotencyKey: string;
  tool: string;
  confirmation: Record<string, unknown> | null;
  inputSummary: Record<string, unknown>;
  mutate: (current: DocumentRecord | null) => DocumentRecord;
}

export interface ProjectWriteInput {
  ownerId: string;
  projectId: string;
  expectedRevision: number;
  idempotencyKey: string;
  tool: string;
  confirmation: Record<string, unknown> | null;
  inputSummary: Record<string, unknown>;
  mutate: (current: ProjectRecord | null) => ProjectRecord;
}

export interface VersionWriteInput {
  ownerId: string;
  versionId: string;
  expectedRevision: number;
  idempotencyKey: string;
  tool: string;
  confirmation: Record<string, unknown> | null;
  inputSummary: Record<string, unknown>;
  mutate: (current: VersionRecord | null) => VersionRecord;
}

export interface WriteResult<T> {
  entity: T;
  replayed: boolean;
  beforeRevision: number | null;
  afterRevision: number;
}

export interface StoneStore {
  getDocument(ownerId: string, id: string): Promise<DocumentRecord | null>;
  listDocuments(ownerId: string, options: ListDocumentsOptions): Promise<Page<DocumentRecord>>;
  getProject(ownerId: string, id: string): Promise<ProjectRecord | null>;
  listProjects(ownerId: string, options: ListProjectsOptions): Promise<Page<ProjectRecord>>;
  listVersions(ownerId: string, options: ListVersionsOptions): Promise<Page<VersionRecord>>;
  writeDocument(input: DocumentWriteInput): Promise<WriteResult<DocumentRecord>>;
  writeProject(input: ProjectWriteInput): Promise<WriteResult<ProjectRecord>>;
  writeVersion(input: VersionWriteInput): Promise<WriteResult<VersionRecord>>;
  listAudit(ownerId: string, limit: number): Promise<readonly AuditEntry[]>;
}

export class McpInputError extends Error {
  public readonly code = "invalid_input";
}

export class McpUnauthorizedError extends Error {
  public readonly code = "unauthorized";
}

export class McpForbiddenError extends Error {
  public readonly code = "forbidden";
}

export class McpNotFoundError extends Error {
  public readonly code = "not_found";
}

export class McpRevisionConflictError extends Error {
  public readonly code = "revision_conflict";
  public readonly currentRevision: number;

  public constructor(currentRevision: number) {
    super(`expectedRevision does not match current revision ${currentRevision}.`);
    this.currentRevision = currentRevision;
  }
}

export class McpRateLimitError extends Error {
  public readonly code = "rate_limited";

  public constructor(public readonly retryAfterSeconds: number) {
    super("Rate limit exceeded.");
  }
}
