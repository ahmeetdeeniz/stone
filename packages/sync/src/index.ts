export type SyncStatus = "saved" | "syncing" | "offline" | "error" | "conflict";

export interface OutboxEvent {
  id: string;
  entityType: string;
  entityId: string;
  operation: "upsert" | "delete";
  baseRevision: number;
  payloadVersion: 1;
  payload: unknown;
  createdAt: string;
  attemptCount: number;
  nextAttemptAt: string | null;
  idempotencyKey: string;
}

export interface RevisionConflict {
  entityId: string;
  baseRevision: number;
  localRevision: number;
  remoteRevision: number;
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
