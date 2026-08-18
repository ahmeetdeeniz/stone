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
  decodeSyncEventCursor,
  encodeSyncEventCursor,
  isPermanentDeletion,
  type SyncEventCursor,
} from "@stone/sync";
import { getFirebaseConfig } from "./config";
import { runDrawingUpload } from "./drawing-lifecycle";
import { DrawingStorageUploadError, FirebaseDrawingStorage, storagePath } from "./storage";
import type { DrawingStoragePayload } from "./storage";

const PAGE_LIMIT = 200;
const MAX_CASCADE_DRAWINGS = 100;
const DRAWING_UPLOAD_STALE_MS = 60 * 60 * 1_000;

type DrawingOperation = "upload" | "delete";
type DrawingOperationState = "pending" | "committed";

export class FirebaseSyncRemote implements SyncRemote {
  private readonly drawingStorage = new FirebaseDrawingStorage();
  public constructor() {
    // Configuration is validated lazily so an unauthenticated shell can render
    // its visible auth error without constructing a native Firestore client.
  }

  public async push(event: OutboxEvent): Promise<RemoteWriteResult> {
    try {
      getFirebaseConfig();
      const database = firestore();
      await this.reconcileDrawingOperations(database, event.ownerId);
      if (isPermanentDeletion(event)) return await this.pushPermanentDeletion(database, event);
      if (event.entityType === "drawing") return await this.pushDrawing(database, event);
      return await this.pushEntity(database, event, null, null);
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
      const database = firestore();
      await this.reconcileDrawingOperations(database, ownerId);
      const safeLimit = Math.max(1, Math.min(limit, PAGE_LIMIT));
      const decodedCursor = decodeSyncEventCursor(cursor);
      let query = database
        .collection("users")
        .doc(ownerId)
        .collection("syncEvents")
        .orderBy("serverUpdatedAt", "asc")
        .orderBy("eventId", "asc")
        .limit(safeLimit);
      if (decodedCursor) {
        query = query.startAfter(
          new firestore.Timestamp(
            decodedCursor.serverUpdatedAtSeconds,
            decodedCursor.serverUpdatedAtNanoseconds,
          ),
          decodedCursor.eventId,
        );
      }
      const snapshot = await query.get();
      const changes = await Promise.all(
        snapshot.docs.map((document) => this.hydrateDrawing(toRemoteChangeFromEvent(document))),
      );
      const lastDocument = snapshot.docs.at(-1);
      const nextCursor = lastDocument
        ? encodeSyncEventCursor(
            toSyncEventCursor(
              lastDocument.data().serverUpdatedAt,
              String(lastDocument.data().eventId ?? lastDocument.id),
            ),
          )
        : cursor;
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
        "focusSessions",
        "focusGoals",
        "devices",
        "settings",
        "drawings",
        "syncEvents",
        "deletionTombstones",
        "drawingOperations",
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

  private async pushDrawing(
    database: FirebaseFirestoreTypes.Module,
    event: OutboxEvent,
  ): Promise<RemoteWriteResult> {
    const markerReference = this.drawingOperationReference(
      database,
      event.ownerId,
      drawingOperationId(event.id, "upload"),
    );
    const sourceStoragePath = storagePath(
      event.ownerId,
      event.entityId,
      event.revision,
      "source.stoneink",
      event.id,
    );
    const previewStoragePath = storagePath(
      event.ownerId,
      event.entityId,
      event.revision,
      "preview.png",
      event.id,
    );
    const entityReference = this.entityReference(
      database,
      event.ownerId,
      event.entityType,
      event.entityId,
    );
    const existingEntity = await entityReference.get();
    const existingData = existingEntity.data();
    if (existingEntity.exists() && existingData?.idempotencyKey === event.idempotencyKey) {
      await markerReference.delete();
      return { kind: "acknowledged", serverUpdatedAt: new Date().toISOString() };
    }
    if (existingEntity.exists() && Number(existingData?.revision ?? 0) !== event.baseRevision) {
      throw new SyncRevisionConflictError({
        remote: toRemoteChange(event, existingData, existingEntity.id),
      });
    }
    await runDrawingUpload({
      createPending: async () => {
        await markerReference.set({
          id: markerReference.id,
          ownerId: event.ownerId,
          operation: "upload" satisfies DrawingOperation,
          drawingId: event.entityId,
          revision: event.revision,
          sourceStoragePath,
          previewStoragePath,
          state: "pending" satisfies DrawingOperationState,
          createdAt: event.createdAt,
          updatedAt: firestore.FieldValue.serverTimestamp(),
        });
      },
      upload: () =>
        this.drawingStorage.upload(
          event.ownerId,
          event.entityId,
          event.revision,
          String(event.payload.sourcePath),
          String(event.payload.previewPath),
          event.id,
        ),
      commit: async (payload) => {
        await this.pushEntity(database, event, payload, markerReference);
      },
      isCommitted: async () => {
        const snapshot = await markerReference.get();
        if (snapshot.exists() && snapshot.data()?.state === "committed") return true;
        const entitySnapshot = await entityReference.get();
        return (
          entitySnapshot.exists() && entitySnapshot.data()?.idempotencyKey === event.idempotencyKey
        );
      },
      deleteUploaded: (payload, operationError) => {
        const uploadedFiles =
          payload?.uploadedFiles ??
          (operationError instanceof DrawingStorageUploadError ? operationError.uploadedFiles : []);
        return this.drawingStorage.deleteStoragePaths(
          uploadedFiles.map((file) => (file === "source" ? sourceStoragePath : previewStoragePath)),
        );
      },
      removeMarker: () => markerReference.delete(),
    });
    return { kind: "acknowledged", serverUpdatedAt: new Date().toISOString() };
  }

  private async pushEntity(
    database: FirebaseFirestoreTypes.Module,
    event: OutboxEvent,
    drawingStoragePayload: DrawingStoragePayload | null,
    markerReference: FirebaseFirestoreTypes.DocumentReference | null,
  ): Promise<RemoteWriteResult> {
    const entityReference = this.entityReference(
      database,
      event.ownerId,
      event.entityType,
      event.entityId,
    );
    const tombstoneReference = this.deletionTombstoneReference(
      database,
      event.ownerId,
      event.entityType,
      event.entityId,
    );
    const eventReference = this.syncEventReference(database, event.ownerId, event.id);
    let acknowledgedAt = new Date().toISOString();
    await database.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(entityReference);
      const tombstoneSnapshot = await transaction.get(tombstoneReference);
      const current = snapshot.exists() ? snapshot.data() : undefined;
      if (tombstoneSnapshot.exists()) {
        throw new SyncRevisionConflictError({
          remote: toRemoteChangeFromTombstone(event, tombstoneSnapshot.data()),
        });
      }
      if (current?.idempotencyKey === event.idempotencyKey) {
        if (markerReference) {
          transaction.set(
            markerReference,
            { state: "committed", updatedAt: firestore.FieldValue.serverTimestamp() },
            { merge: true },
          );
        }
        return;
      }
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
      if (markerReference) {
        transaction.set(
          markerReference,
          { state: "committed", updatedAt: firestore.FieldValue.serverTimestamp() },
          { merge: true },
        );
      }
      acknowledgedAt = new Date().toISOString();
    });
    return { kind: "acknowledged", serverUpdatedAt: acknowledgedAt };
  }

  private async pushPermanentDeletion(
    database: FirebaseFirestoreTypes.Module,
    event: OutboxEvent,
  ): Promise<RemoteWriteResult> {
    const cascadeDrawingIds =
      event.entityType === "document" ? uniqueStrings(event.payload.cascadeDrawingIds) : [];
    if (cascadeDrawingIds.length > MAX_CASCADE_DRAWINGS) {
      throw new SyncTransportError(
        `Permanent deletion contains more than ${MAX_CASCADE_DRAWINGS} drawings.`,
        false,
      );
    }
    const drawingIds = event.entityType === "drawing" ? [event.entityId] : cascadeDrawingIds;
    const entityReference = this.entityReference(
      database,
      event.ownerId,
      event.entityType,
      event.entityId,
    );
    const tombstoneReference = this.deletionTombstoneReference(
      database,
      event.ownerId,
      event.entityType,
      event.entityId,
    );
    const drawingReferences = drawingIds.map((drawingId) => ({
      id: drawingId,
      entity: this.entityReference(database, event.ownerId, "drawing", drawingId),
      tombstone: this.deletionTombstoneReference(database, event.ownerId, "drawing", drawingId),
      marker: this.drawingOperationReference(
        database,
        event.ownerId,
        drawingOperationId(`${event.id}:${drawingId}`, "delete"),
      ),
    }));
    const eventReference = this.syncEventReference(database, event.ownerId, event.id);
    const deletedAt = stringValue(event.payload.deletedAt) || event.createdAt;
    await database.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(entityReference);
      const tombstoneSnapshot = await transaction.get(tombstoneReference);
      const drawingSnapshots = [];
      for (const reference of drawingReferences) {
        drawingSnapshots.push({
          reference,
          entitySnapshot: await transaction.get(reference.entity),
          tombstoneSnapshot: await transaction.get(reference.tombstone),
        });
      }
      const current = snapshot.exists() ? snapshot.data() : undefined;
      const currentRevision = Math.max(
        Number(current?.revision ?? 0),
        Number(tombstoneSnapshot.data()?.revision ?? 0),
      );
      if (current?.idempotencyKey === event.idempotencyKey) return;
      if (Number(tombstoneSnapshot.data()?.revision ?? 0) >= event.revision) return;
      if (currentRevision !== event.baseRevision) {
        throw new SyncRevisionConflictError({
          remote: tombstoneSnapshot.exists()
            ? toRemoteChangeFromTombstone(event, tombstoneSnapshot.data())
            : toRemoteChange(event, current, snapshot.id),
        });
      }
      if (event.entityType !== "drawing") {
        if (snapshot.exists()) transaction.delete(entityReference);
        transaction.set(
          tombstoneReference,
          toDeletionTombstone(event, event.entityType, event.entityId, event.revision, deletedAt),
          { merge: false },
        );
      }
      for (const item of drawingSnapshots) {
        const drawingRevision = Math.max(
          Number(item.entitySnapshot.data()?.revision ?? 0) + 1,
          Number(item.tombstoneSnapshot.data()?.revision ?? 0),
          event.revision,
        );
        if (item.entitySnapshot.exists()) transaction.delete(item.reference.entity);
        transaction.set(
          item.reference.tombstone,
          toDeletionTombstone(event, "drawing", item.reference.id, drawingRevision, deletedAt),
          { merge: false },
        );
        transaction.set(
          item.reference.marker,
          {
            id: item.reference.marker.id,
            ownerId: event.ownerId,
            operation: "delete" satisfies DrawingOperation,
            drawingId: item.reference.id,
            revision: drawingRevision,
            sourceStoragePath: "",
            previewStoragePath: "",
            state: "pending" satisfies DrawingOperationState,
            createdAt: event.createdAt,
            updatedAt: firestore.FieldValue.serverTimestamp(),
          },
          { merge: false },
        );
      }
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
          payload: event.payload,
          createdAt: event.createdAt,
          idempotencyKey: event.idempotencyKey,
          serverUpdatedAt: firestore.FieldValue.serverTimestamp(),
        },
        { merge: false },
      );
    });
    for (const drawingId of drawingIds) {
      await this.drawingStorage.deleteDrawing(event.ownerId, drawingId);
      await this.drawingOperationReference(
        database,
        event.ownerId,
        drawingOperationId(`${event.id}:${drawingId}`, "delete"),
      ).delete();
    }
    return { kind: "acknowledged", serverUpdatedAt: new Date().toISOString() };
  }

  private async reconcileDrawingOperations(
    database: FirebaseFirestoreTypes.Module,
    ownerId: string,
  ): Promise<void> {
    const snapshot = await database
      .collection("users")
      .doc(ownerId)
      .collection("drawingOperations")
      .limit(200)
      .get();
    for (const document of snapshot.docs) {
      const marker = toDrawingOperation(document.id, document.data());
      if (!marker) throw new Error("Invalid drawing operation marker.");
      if (marker.state === "committed") {
        await document.ref.delete();
        continue;
      }
      if (marker.operation === "delete") {
        await this.drawingStorage.deleteDrawing(ownerId, marker.drawingId);
        await document.ref.delete();
        continue;
      }
      const createdAt = Date.parse(marker.createdAt);
      if (!Number.isFinite(createdAt) || Date.now() - createdAt >= DRAWING_UPLOAD_STALE_MS) {
        await this.drawingStorage.deleteStoragePaths([
          marker.sourceStoragePath,
          marker.previewStoragePath,
        ]);
        await document.ref.delete();
      }
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

  private syncEventReference(
    database: FirebaseFirestoreTypes.Module,
    ownerId: string,
    eventId: string,
  ): FirebaseFirestoreTypes.DocumentReference {
    return database.collection("users").doc(ownerId).collection("syncEvents").doc(eventId);
  }

  private deletionTombstoneReference(
    database: FirebaseFirestoreTypes.Module,
    ownerId: string,
    entityType: SyncEntityType,
    entityId: string,
  ): FirebaseFirestoreTypes.DocumentReference {
    return database
      .collection("users")
      .doc(ownerId)
      .collection("deletionTombstones")
      .doc(tombstoneDocumentId(entityType, entityId));
  }

  private drawingOperationReference(
    database: FirebaseFirestoreTypes.Module,
    ownerId: string,
    operationId: string,
  ): FirebaseFirestoreTypes.DocumentReference {
    return database
      .collection("users")
      .doc(ownerId)
      .collection("drawingOperations")
      .doc(operationId);
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
    case "focus":
      return "focusSessions";
    case "focus_goal":
      return "focusGoals";
    case "device":
      return "devices";
    case "settings":
      return "settings";
    case "drawing":
      return "drawings";
  }
}

function drawingOperationId(eventId: string, operation: DrawingOperation): string {
  return `${operation}:${encodeURIComponent(eventId)}`;
}

function tombstoneDocumentId(entityType: SyncEntityType, entityId: string): string {
  return `${entityType}:${encodeURIComponent(entityId)}`;
}

function toDeletionTombstone(
  event: OutboxEvent,
  entityType: SyncEntityType,
  entityId: string,
  revision: number,
  deletedAt: string,
): Record<string, unknown> {
  const cascadeDrawingIds =
    entityType === "document" ? uniqueStrings(event.payload.cascadeDrawingIds) : [];
  return {
    id: tombstoneDocumentId(entityType, entityId),
    ownerId: event.ownerId,
    entityType,
    entityId,
    revision,
    deletedAt,
    createdAt: event.createdAt,
    sourceEventId: event.id,
    ...(cascadeDrawingIds.length > 0 ? { cascadeDrawingIds } : {}),
  };
}

function toRemoteChangeFromTombstone(
  event: OutboxEvent,
  value: FirebaseFirestoreTypes.DocumentData | undefined,
): RemoteChange {
  const data = toRecord(value ?? {});
  const entityType = isEntityType(data.entityType) ? data.entityType : event.entityType;
  const entityId = stringValue(data.entityId) || event.entityId;
  const revision = Number(data.revision ?? event.revision);
  const deletedAt = stringValue(data.deletedAt) || event.createdAt;
  const cascadeDrawingIds = uniqueStrings(data.cascadeDrawingIds);
  return {
    eventId: stringValue(data.sourceEventId) || `tombstone:${entityType}:${entityId}`,
    ownerId: stringValue(data.ownerId) || event.ownerId,
    entityType,
    entityId,
    operation: "delete",
    revision,
    payloadVersion: 1,
    payload: {
      id: entityId,
      ownerId: event.ownerId,
      revision,
      deletedAt,
      updatedAt: deletedAt,
      updatedByDeviceId: "remote",
      purge: true,
      ...(cascadeDrawingIds.length > 0 ? { cascadeDrawingIds } : {}),
    },
    createdAt: stringValue(data.createdAt) || event.createdAt,
    idempotencyKey: stringValue(data.sourceEventId) || `tombstone:${entityType}:${entityId}`,
  };
}

function toDrawingOperation(
  id: string,
  value: FirebaseFirestoreTypes.DocumentData | undefined,
): {
  id: string;
  ownerId: string;
  operation: DrawingOperation;
  drawingId: string;
  revision: number;
  sourceStoragePath: string;
  previewStoragePath: string;
  state: DrawingOperationState;
  createdAt: string;
} | null {
  const data = toRecord(value ?? {});
  if (
    (data.operation !== "upload" && data.operation !== "delete") ||
    (data.state !== "pending" && data.state !== "committed") ||
    typeof data.ownerId !== "string" ||
    typeof data.drawingId !== "string" ||
    typeof data.revision !== "number" ||
    !Number.isSafeInteger(data.revision) ||
    typeof data.sourceStoragePath !== "string" ||
    typeof data.previewStoragePath !== "string" ||
    typeof data.createdAt !== "string"
  ) {
    return null;
  }
  return {
    id,
    ownerId: data.ownerId,
    operation: data.operation,
    drawingId: data.drawingId,
    revision: data.revision,
    sourceStoragePath: data.sourceStoragePath,
    previewStoragePath: data.previewStoragePath,
    state: data.state,
    createdAt: data.createdAt,
  };
}

function uniqueStrings(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === "string"))];
}

function isEntityType(value: unknown): value is SyncEntityType {
  return (
    value === "document" ||
    value === "project" ||
    value === "version" ||
    value === "task" ||
    value === "calendar" ||
    value === "focus" ||
    value === "focus_goal" ||
    value === "device" ||
    value === "settings" ||
    value === "drawing"
  );
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

function toSyncEventCursor(value: unknown, eventId: string): SyncEventCursor {
  if (value instanceof firestore.Timestamp) {
    return {
      serverUpdatedAtSeconds: value.seconds,
      serverUpdatedAtNanoseconds: value.nanoseconds,
      eventId,
    };
  }
  if (value instanceof Date) {
    const timestamp = firestore.Timestamp.fromDate(value);
    return {
      serverUpdatedAtSeconds: timestamp.seconds,
      serverUpdatedAtNanoseconds: timestamp.nanoseconds,
      eventId,
    };
  }
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const candidate = value as { seconds?: unknown; nanoseconds?: unknown };
    if (typeof candidate.seconds === "number" && typeof candidate.nanoseconds === "number") {
      return {
        serverUpdatedAtSeconds: candidate.seconds,
        serverUpdatedAtNanoseconds: candidate.nanoseconds,
        eventId,
      };
    }
  }
  throw new Error("Sync event is missing its serverUpdatedAt timestamp.");
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
