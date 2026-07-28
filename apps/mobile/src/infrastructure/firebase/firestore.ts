import firestore, { type FirebaseFirestoreTypes } from "@react-native-firebase/firestore";
import {
  SyncRevisionConflictError,
  SyncTransportError,
  type OutboxEvent,
  type RemoteChange,
  type RemotePage,
  type RemoteWriteResult,
  type SyncEntityType,
  type SyncOperation,
  type SyncRemote,
} from "@stone/sync";
import { getFirebaseConfig } from "./config";
import { FirebaseDrawingStorage } from "./storage";

const PAGE_LIMIT = 200;

export class FirebaseSyncRemote implements SyncRemote {
  private readonly drawingStorage = new FirebaseDrawingStorage();
  public constructor() {
    // Configuration is validated lazily so an unauthenticated shell can render
    // its visible auth error without constructing a native Firestore client.
  }

  public async push(event: OutboxEvent): Promise<RemoteWriteResult> {
    try {
      getFirebaseConfig();
      let drawingStoragePayload: Awaited<ReturnType<FirebaseDrawingStorage["upload"]>> | null =
        null;
      if (event.entityType === "drawing") {
        drawingStoragePayload = await this.drawingStorage.upload(
          event.ownerId,
          event.entityId,
          event.revision,
          String(event.payload.sourcePath),
          String(event.payload.previewPath),
        );
      }
      const database = firestore();
      const entityReference = this.entityReference(
        database,
        event.ownerId,
        event.entityType,
        event.entityId,
      );
      const eventReference = database
        .collection("users")
        .doc(event.ownerId)
        .collection("syncEvents")
        .doc(event.id);
      let acknowledgedAt = new Date().toISOString();
      await database.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(entityReference);
        const current = snapshot.exists() ? snapshot.data() : undefined;
        if (current?.idempotencyKey === event.idempotencyKey) return;
        const remoteRevision = Number(current?.revision ?? 0);
        if (remoteRevision !== event.baseRevision) {
          throw new SyncRevisionConflictError({
            remote: toRemoteChange(event, current, snapshot.id),
          });
        }
        const payload = {
          ...event.payload,
          ...(drawingStoragePayload
            ? {
                sourcePath: drawingStoragePayload.sourceStoragePath,
                previewPath: drawingStoragePayload.previewStoragePath,
                sourceStoragePath: drawingStoragePayload.sourceStoragePath,
                previewStoragePath: drawingStoragePayload.previewStoragePath,
              }
            : {}),
          ownerId: event.ownerId,
          revision: event.revision,
          idempotencyKey: event.idempotencyKey,
          lastEventId: event.id,
          updatedAt: event.payload.updatedAt ?? event.createdAt,
        };
        transaction.set(entityReference, payload, { merge: false });
        transaction.set(
          eventReference,
          {
            eventId: event.id,
            ownerId: event.ownerId,
            entityType: event.entityType,
            entityId: event.entityId,
            operation: event.operation,
            revision: event.revision,
            payloadVersion: event.payloadVersion,
            payload,
            createdAt: event.createdAt,
            idempotencyKey: event.idempotencyKey,
            serverUpdatedAt: firestore.FieldValue.serverTimestamp(),
          },
          { merge: false },
        );
        acknowledgedAt = new Date().toISOString();
      });
      return { kind: "acknowledged", serverUpdatedAt: acknowledgedAt };
    } catch (error) {
      if (error instanceof SyncRevisionConflictError) {
        if (error.details.remote.entityType === "drawing") {
          throw new SyncRevisionConflictError({
            remote: await this.hydrateDrawing(error.details.remote),
          });
        }
        throw error;
      }
      throw toTransportError(error);
    }
  }

  public async pull(ownerId: string, cursor: string | null, limit: number): Promise<RemotePage> {
    try {
      getFirebaseConfig();
      const safeLimit = Math.max(1, Math.min(limit, PAGE_LIMIT));
      let query = firestore()
        .collection("users")
        .doc(ownerId)
        .collection("syncEvents")
        .orderBy("eventId", "asc")
        .limit(safeLimit);
      if (cursor) query = query.startAfter(cursor);
      const snapshot = await query.get();
      const changes = await Promise.all(
        snapshot.docs.map((document) => this.hydrateDrawing(toRemoteChangeFromEvent(document))),
      );
      const nextCursor = changes.at(-1)?.eventId ?? cursor;
      return {
        changes,
        cursor: nextCursor,
        hasMore: changes.length === safeLimit,
      };
    } catch (error) {
      throw toTransportError(error);
    }
  }

  public async deleteOwnerData(ownerId: string): Promise<void> {
    try {
      getFirebaseConfig();
      await this.drawingStorage.deleteOwnerDrawings(ownerId);
      const database = firestore();
      for (const collection of [
        "documents",
        "projects",
        "versions",
        "tasks",
        "calendar",
        "devices",
        "settings",
        "drawings",
        "syncEvents",
        "conflicts",
      ]) {
        const snapshot = await database
          .collection("users")
          .doc(ownerId)
          .collection(collection)
          .get();
        for (let index = 0; index < snapshot.docs.length; index += 450) {
          const batch = database.batch();
          for (const document of snapshot.docs.slice(index, index + 450))
            batch.delete(document.ref);
          await batch.commit();
        }
      }
    } catch (error) {
      throw toTransportError(error);
    }
  }

  private entityReference(
    database: FirebaseFirestoreTypes.Module,
    ownerId: string,
    entityType: SyncEntityType,
    entityId: string,
  ): FirebaseFirestoreTypes.DocumentReference {
    return database
      .collection("users")
      .doc(ownerId)
      .collection(collectionFor(entityType))
      .doc(entityId);
  }

  private async hydrateDrawing(change: RemoteChange): Promise<RemoteChange> {
    if (change.entityType !== "drawing") return change;
    const sourceStoragePath = stringValue(
      change.payload.sourceStoragePath ?? change.payload.sourcePath,
    );
    const previewStoragePath = stringValue(
      change.payload.previewStoragePath ?? change.payload.previewPath,
    );
    if (!sourceStoragePath || !previewStoragePath) return change;
    const files = await this.drawingStorage.download(
      change.ownerId,
      change.entityId,
      sourceStoragePath,
      previewStoragePath,
    );
    return {
      ...change,
      payload: { ...change.payload, sourcePath: files.sourcePath, previewPath: files.previewPath },
    };
  }
}

function collectionFor(entityType: SyncEntityType): string {
  switch (entityType) {
    case "document":
      return "documents";
    case "project":
      return "projects";
    case "version":
      return "versions";
    case "task":
      return "tasks";
    case "calendar":
      return "calendar";
    case "device":
      return "devices";
    case "settings":
      return "settings";
    case "drawing":
      return "drawings";
  }
}

function toRemoteChange(
  event: OutboxEvent,
  current: FirebaseFirestoreTypes.DocumentData | undefined,
  snapshotId: string,
): RemoteChange {
  return {
    eventId: String(current?.lastEventId ?? `remote:${snapshotId}`),
    ownerId: event.ownerId,
    entityType: event.entityType,
    entityId: event.entityId,
    operation: "upsert",
    revision: Number(current?.revision ?? 0),
    payloadVersion: 1,
    payload: toRecord(current ?? {}),
    createdAt: String(current?.updatedAt ?? new Date().toISOString()),
    idempotencyKey: String(current?.idempotencyKey ?? "remote"),
  };
}

function toRemoteChangeFromEvent(
  document: FirebaseFirestoreTypes.QueryDocumentSnapshot,
): RemoteChange {
  const data = document.data();
  return {
    eventId: String(data.eventId ?? document.id),
    ownerId: String(data.ownerId),
    entityType: data.entityType as SyncEntityType,
    entityId: String(data.entityId),
    operation: data.operation as SyncOperation,
    revision: Number(data.revision),
    payloadVersion: 1,
    payload: toRecord(data.payload),
    createdAt: String(data.createdAt),
    idempotencyKey: String(data.idempotencyKey),
  };
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function toTransportError(error: unknown): SyncTransportError {
  if (error instanceof SyncTransportError) return error;
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = String(error.code);
    const retryable = !["permission-denied", "invalid-argument", "failed-precondition"].includes(
      code,
    );
    return new SyncTransportError(`Firestore ${code}`, retryable);
  }
  return new SyncTransportError(error instanceof Error ? error.message : "Firestore sync failed.");
}
