export type SyncStatus = "saved" | "syncing" | "offline" | "error" | "conflict";

export type SyncEntityType =
  "document" | "project" | "version" | "task" | "calendar" | "device" | "settings" | "drawing";
export type SyncOperation = "upsert" | "delete";

export interface OutboxEvent {
  id: string;
  ownerId: string;
  entityType: SyncEntityType;
  entityId: string;
  operation: SyncOperation;
  baseRevision: number;
  revision: number;
  payloadVersion: 1;
  payload: Record<string, unknown>;
  createdAt: string;
  attemptCount: number;
  nextAttemptAt: string | null;
  idempotencyKey: string;
  lastError: string | null;
}

export interface RemoteChange {
  eventId: string;
  ownerId: string;
  entityType: SyncEntityType;
  entityId: string;
  operation: SyncOperation;
  revision: number;
  payloadVersion: 1;
  payload: Record<string, unknown>;
  createdAt: string;
  idempotencyKey: string;
}

export interface RemotePage {
  changes: readonly RemoteChange[];
  cursor: string | null;
  hasMore: boolean;
}

export interface RemoteWriteResult {
  kind: "acknowledged";
  serverUpdatedAt: string;
}

export interface RemoteConflictDetails {
  remote: RemoteChange;
}

export class SyncRevisionConflictError extends Error {
  public readonly details: RemoteConflictDetails;

  public constructor(details: RemoteConflictDetails) {
    super("Remote revision changed before the local write was applied.");
    this.name = "SyncRevisionConflictError";
    this.details = details;
  }
}

export class SyncTransportError extends Error {
  public readonly retryable: boolean;

  public constructor(message: string, retryable = true) {
    super(message);
    this.name = "SyncTransportError";
    this.retryable = retryable;
  }
}

export interface SyncRemote {
  push(event: OutboxEvent): Promise<RemoteWriteResult>;
  pull(ownerId: string, cursor: string | null, limit: number): Promise<RemotePage>;
}

export type ApplyRemoteResult = "applied" | "ignored" | "conflict";

export interface SyncLocalStore {
  pending(ownerId: string, now: string, limit: number): Promise<readonly OutboxEvent[]>;
  acknowledgeOutbox(eventId: string): Promise<void>;
  deferOutbox(eventId: string, nextAttemptAt: string, message: string): Promise<void>;
  blockOutbox(eventId: string, message: string): Promise<void>;
  applyRemote(change: RemoteChange): Promise<ApplyRemoteResult>;
  getCursor(ownerId: string): Promise<string | null>;
  saveCursor(ownerId: string, cursor: string): Promise<void>;
  countOpenConflicts(ownerId: string): Promise<number>;
}

export interface SyncRunResult {
  status: SyncStatus;
  pushed: number;
  pulled: number;
  conflicts: number;
  deferred: number;
}

export interface SyncEngineOptions {
  pageSize?: number;
  now?: () => string;
  onStatus?: (status: SyncStatus) => void;
}

export class SyncEngine {
  private readonly pageSize: number;
  private readonly now: () => string;
  private readonly onStatus: ((status: SyncStatus) => void) | undefined;

  public constructor(
    private readonly remote: SyncRemote,
    private readonly local: SyncLocalStore,
    options: SyncEngineOptions = {},
  ) {
    this.pageSize = Math.max(1, Math.min(options.pageSize ?? 50, 200));
    this.now = options.now ?? (() => new Date().toISOString());
    this.onStatus = options.onStatus;
  }

  public async run(ownerId: string): Promise<SyncRunResult> {
    this.onStatus?.("syncing");
    let pushed = 0;
    let pulled = 0;
    let conflicts = 0;
    let deferred = 0;

    try {
      const pullResult = await this.pullAll(ownerId);
      pulled = pullResult.pulled;
      conflicts += pullResult.conflicts;

      const events = await this.local.pending(ownerId, this.now(), this.pageSize);
      for (const event of events) {
        try {
          await this.remote.push(event);
          await this.local.acknowledgeOutbox(event.id);
          pushed += 1;
        } catch (error) {
          if (error instanceof SyncRevisionConflictError) {
            await this.local.applyRemote(error.details.remote);
            await this.local.blockOutbox(event.id, "Revision conflict requires user resolution.");
            conflicts += 1;
            continue;
          }
          if (error instanceof SyncTransportError && error.retryable) {
            const nextAttemptAt = new Date(
              Date.now() + retryDelayMs(event.attemptCount),
            ).toISOString();
            await this.local.deferOutbox(event.id, nextAttemptAt, error.message);
            deferred += 1;
            continue;
          }
          await this.local.blockOutbox(event.id, toErrorMessage(error));
        }
      }

      const openConflicts = await this.local.countOpenConflicts(ownerId);
      const status: SyncStatus =
        openConflicts > 0 || conflicts > 0 ? "conflict" : deferred > 0 ? "offline" : "saved";
      this.onStatus?.(status);
      return { status, pushed, pulled, conflicts, deferred };
    } catch (error) {
      if (error instanceof SyncTransportError && error.retryable) {
        this.onStatus?.("offline");
        return { status: "offline", pushed, pulled, conflicts, deferred };
      }
      this.onStatus?.("error");
      throw error;
    }
  }

  private async pullAll(ownerId: string): Promise<{ pulled: number; conflicts: number }> {
    let cursor = await this.local.getCursor(ownerId);
    let pulled = 0;
    let conflicts = 0;
    let hasMore = true;
    while (hasMore) {
      const page = await this.remote.pull(ownerId, cursor, this.pageSize);
      for (const change of page.changes) {
        const result = await this.local.applyRemote(change);
        pulled += 1;
        if (result === "conflict") conflicts += 1;
      }
      if (page.cursor) {
        await this.local.saveCursor(ownerId, page.cursor);
        cursor = page.cursor;
      }
      hasMore = page.hasMore;
      if (page.changes.length === 0) hasMore = false;
    }
    return { pulled, conflicts };
  }
}

export function detectRevisionConflict(input: {
  baseRevision: number;
  remoteRevision: number;
}): boolean {
  return input.baseRevision !== input.remoteRevision;
}

export function retryDelayMs(
  attemptCount: number,
  baseDelayMs = 1_000,
  maxDelayMs = 60_000,
): number {
  const safeAttempt = Math.max(0, Math.floor(attemptCount));
  return Math.min(maxDelayMs, baseDelayMs * 2 ** safeAttempt);
}

export interface ThreeWayMergeResult {
  text: string;
  hasConflicts: boolean;
}

export function mergeTextThreeWay(
  base: string,
  local: string,
  remote: string,
): ThreeWayMergeResult {
  if (local === remote) return { text: local, hasConflicts: false };
  if (local === base) return { text: remote, hasConflicts: false };
  if (remote === base) return { text: local, hasConflicts: false };
  return {
    text: `<<<<<<< LOCAL\n${local}\n=======\n${remote}\n>>>>>>> REMOTE\n`,
    hasConflicts: true,
  };
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Sync failed.";
}
