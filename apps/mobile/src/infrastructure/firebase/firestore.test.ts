import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  decodeSyncEventCursor,
  SyncRevisionConflictError,
  type OutboxEvent,
  type RemoteChange,
} from "@stone/sync";
import { storagePath } from "./storage-path";

type StoredDocument = Record<string, unknown>;
type FirestoreWriteOptions = { merge?: boolean };
const SERVER_TIMESTAMP = "__server_timestamp__";

let activeFirestore: FakeFirestoreState;
let activeStorage: FakeStorageState;

class FakeTimestamp {
  public constructor(
    public readonly seconds: number,
    public readonly nanoseconds: number,
  ) {}
}

vi.mock("@react-native-firebase/firestore", () => {
  const firestore = Object.assign(() => activeFirestore.module, {
    FieldValue: { serverTimestamp: () => SERVER_TIMESTAMP },
    Timestamp: FakeTimestamp,
  });
  return { default: firestore };
});

vi.mock("@react-native-firebase/storage", () => ({
  default: () => activeStorage.module,
}));

vi.mock("expo-file-system", () => ({
  Directory: class {
    public create(): void {}
  },
  File: class {
    public readonly exists = true;
    public readonly uri: string;

    public constructor(...parts: unknown[]) {
      this.uri = parts.filter((part): part is string => typeof part === "string").join("/");
    }

    public delete(): void {}
    public textSync(): string {
      return "";
    }
    public bytes(): Promise<Uint8Array> {
      return Promise.resolve(new Uint8Array());
    }
    public static downloadFileAsync(): Promise<void> {
      return Promise.resolve();
    }
  },
  Paths: { document: "file:///documents" },
}));

vi.mock("./config", () => ({
  getFirebaseConfig: () => ({
    apiKey: "test",
    authDomain: "test",
    projectId: "test",
    storageBucket: "test",
    messagingSenderId: "test",
    appId: "test",
  }),
}));

describe("Firebase sync deletion and drawing boundaries", () => {
  beforeEach(() => {
    activeFirestore = new FakeFirestoreState();
    activeStorage = new FakeStorageState();
  });

  it("commits a normal drawing upload and metadata together with its marker", async () => {
    const { FirebaseSyncRemote } = await import("./firestore");
    const remote = new FirebaseSyncRemote();
    const event = drawingEvent();

    await expect(remote.push(event)).resolves.toMatchObject({ kind: "acknowledged" });

    expect(activeStorage.uploads).toEqual([
      storagePath("owner", "drawing-1", 1, "source.stoneink", event.id),
      storagePath("owner", "drawing-1", 1, "preview.png", event.id),
    ]);
    expect(activeFirestore.get(entityPath("owner", "drawings", "drawing-1"))).toMatchObject({
      sourceStoragePath: storagePath("owner", "drawing-1", 1, "source.stoneink", event.id),
      previewStoragePath: storagePath("owner", "drawing-1", 1, "preview.png", event.id),
      revision: 1,
    });
    expect(activeFirestore.get(collectionPath("owner", "drawingOperations"))).toBeUndefined();
    expect(activeFirestore.get(entityPath("owner", "syncEvents", event.id))).toMatchObject({
      eventId: event.id,
      entityType: "drawing",
    });
  });

  it("does not re-upload after metadata committed but marker cleanup failed", async () => {
    const { FirebaseSyncRemote } = await import("./firestore");
    const remote = new FirebaseSyncRemote();
    const event = drawingEvent();
    activeFirestore.failDeletes.add(uploadMarkerPath(event.id));

    await expect(remote.push(event)).rejects.toMatchObject({
      name: "SyncTransportError",
      retryable: true,
    });
    expect(activeFirestore.get(entityPath("owner", "drawings", "drawing-1"))).toMatchObject({
      idempotencyKey: event.idempotencyKey,
    });
    expect(activeFirestore.get(uploadMarkerPath(event.id))).toMatchObject({
      state: "committed",
    });

    activeFirestore.failDeletes.clear();
    await expect(remote.push(event)).resolves.toMatchObject({ kind: "acknowledged" });
    expect(activeStorage.uploads).toHaveLength(2);
    expect(activeFirestore.get(uploadMarkerPath(event.id))).toBeUndefined();
  });

  it("keeps the accepted drawing revision when a later edit uploads a new variant", async () => {
    const { FirebaseSyncRemote } = await import("./firestore");
    const remote = new FirebaseSyncRemote();
    const firstEvent = drawingEvent();
    const secondEvent = drawingEvent({ baseRevision: 1, revision: 2 });

    await expect(remote.push(firstEvent)).resolves.toMatchObject({ kind: "acknowledged" });
    await expect(remote.push(secondEvent)).resolves.toMatchObject({ kind: "acknowledged" });

    expect(activeStorage.blobs).toEqual(
      new Set([
        storagePath("owner", "drawing-1", 1, "source.stoneink", firstEvent.id),
        storagePath("owner", "drawing-1", 1, "preview.png", firstEvent.id),
        storagePath("owner", "drawing-1", 2, "source.stoneink", secondEvent.id),
        storagePath("owner", "drawing-1", 2, "preview.png", secondEvent.id),
      ]),
    );
    expect(activeFirestore.get(entityPath("owner", "drawings", "drawing-1"))).toMatchObject({
      revision: 2,
      sourceStoragePath: storagePath("owner", "drawing-1", 2, "source.stoneink", secondEvent.id),
    });
  });

  it("compensates a drawing upload after a Firestore conflict and reuses the same paths on retry", async () => {
    const { FirebaseSyncRemote } = await import("./firestore");
    const remote = new FirebaseSyncRemote();
    const event = drawingEvent({ baseRevision: 1, revision: 2 });
    activeFirestore.seed(entityPath("owner", "drawings", "drawing-1"), {
      id: "drawing-1",
      ownerId: "owner",
      revision: 1,
      idempotencyKey: "other-device:drawing-1:1",
    });
    activeFirestore.nextTransactionError = new SyncRevisionConflictError({
      remote: drawingRemoteChange(event),
    });

    await expect(remote.push(event)).rejects.toBeInstanceOf(SyncRevisionConflictError);
    expect(activeStorage.blobs.size).toBe(0);
    expect(activeStorage.deletes).toHaveLength(2);
    expect(activeFirestore.get(uploadMarkerPath(event.id))).toBeUndefined();

    activeFirestore.seed(entityPath("owner", "drawings", "drawing-1"), {
      id: "drawing-1",
      ownerId: "owner",
      revision: 1,
      idempotencyKey: "other-device:drawing-1:1",
    });
    await expect(remote.push(event)).resolves.toMatchObject({ kind: "acknowledged" });
    expect(new Set(activeStorage.uploads)).toEqual(
      new Set([
        storagePath("owner", "drawing-1", 2, "source.stoneink", event.id),
        storagePath("owner", "drawing-1", 2, "preview.png", event.id),
      ]),
    );
    expect(activeStorage.blobs.size).toBe(2);
    expect(activeFirestore.get(uploadMarkerPath(event.id))).toBeUndefined();
  });

  it("does not delete an accepted conflicting revision during preflight", async () => {
    const { FirebaseSyncRemote } = await import("./firestore");
    const remote = new FirebaseSyncRemote();
    const event = drawingEvent({ baseRevision: 1, revision: 2 });
    activeFirestore.seed(entityPath("owner", "drawings", "drawing-1"), {
      id: "drawing-1",
      ownerId: "owner",
      revision: 2,
      idempotencyKey: "other-device:drawing-1:2",
      sourceStoragePath: storagePath(
        "owner",
        "drawing-1",
        2,
        "source.stoneink",
        "other-device:drawing-1:2",
      ),
      previewStoragePath: storagePath(
        "owner",
        "drawing-1",
        2,
        "preview.png",
        "other-device:drawing-1:2",
      ),
    });
    activeStorage.blobs.add(
      storagePath("owner", "drawing-1", 2, "source.stoneink", "other-device:drawing-1:2"),
    );
    activeStorage.blobs.add(
      storagePath("owner", "drawing-1", 2, "preview.png", "other-device:drawing-1:2"),
    );

    await expect(remote.push(event)).rejects.toBeInstanceOf(SyncRevisionConflictError);

    expect(activeStorage.uploads).toEqual([]);
    expect(activeStorage.deletes).toEqual([]);
    expect(activeStorage.blobs).toEqual(
      new Set([
        storagePath("owner", "drawing-1", 2, "source.stoneink", "other-device:drawing-1:2"),
        storagePath("owner", "drawing-1", 2, "preview.png", "other-device:drawing-1:2"),
      ]),
    );
  });

  it("does not commit metadata when the second blob upload fails", async () => {
    const { FirebaseSyncRemote } = await import("./firestore");
    const remote = new FirebaseSyncRemote();
    const event = drawingEvent();
    activeStorage.failUploads.add(storagePath("owner", "drawing-1", 1, "preview.png", event.id));

    await expect(remote.push(event)).rejects.toMatchObject({
      name: "SyncTransportError",
      retryable: true,
    });
    expect(activeFirestore.get(entityPath("owner", "drawings", "drawing-1"))).toBeUndefined();
    expect(activeFirestore.get(entityPath("owner", "syncEvents", event.id))).toBeUndefined();
    expect(activeFirestore.get(uploadMarkerPath(event.id))).toBeUndefined();
    expect(activeStorage.blobs.size).toBe(0);
  });

  it("keeps a failed cleanup marker visible and reconciles it on retry", async () => {
    const { FirebaseSyncRemote } = await import("./firestore");
    const remote = new FirebaseSyncRemote();
    const event = drawingEvent({
      baseRevision: 1,
      revision: 2,
      createdAt: "2020-01-01T00:00:00.000Z",
    });
    activeFirestore.seed(entityPath("owner", "drawings", "drawing-1"), {
      id: "drawing-1",
      ownerId: "owner",
      revision: 1,
      idempotencyKey: "other-device:drawing-1:1",
    });
    activeFirestore.nextTransactionError = new SyncRevisionConflictError({
      remote: drawingRemoteChange(event),
    });
    const sourcePath = storagePath("owner", "drawing-1", 2, "source.stoneink", event.id);
    activeStorage.failDeletes.add(sourcePath);

    await expect(remote.push(event)).rejects.toMatchObject({
      name: "SyncTransportError",
      retryable: true,
    });
    expect(activeFirestore.get(uploadMarkerPath(event.id))).toMatchObject({ state: "pending" });

    activeStorage.failDeletes.clear();
    await expect(remote.push(event)).resolves.toMatchObject({ kind: "acknowledged" });
    expect(activeFirestore.get(uploadMarkerPath(event.id))).toBeUndefined();
    expect(activeStorage.blobs.size).toBe(2);
  });

  it("purges remote documents and drawings idempotently while blocking stale upserts", async () => {
    const { FirebaseSyncRemote } = await import("./firestore");
    const remote = new FirebaseSyncRemote();
    const event = permanentDocumentEvent();
    activeFirestore.seed(entityPath("owner", "documents", "note-1"), {
      id: "note-1",
      ownerId: "owner",
      revision: 2,
      idempotencyKey: "device:note-1:2",
    });
    activeFirestore.seed(entityPath("owner", "drawings", "drawing-1"), {
      id: "drawing-1",
      ownerId: "owner",
      documentId: "note-1",
      revision: 3,
      idempotencyKey: "device:drawing-1:3",
    });
    activeFirestore.seed(entityPath("owner", "documents", "note-2"), {
      id: "note-2",
      ownerId: "owner",
      revision: 1,
    });
    activeFirestore.seed(entityPath("other", "documents", "other-note"), {
      id: "other-note",
      ownerId: "other",
      revision: 1,
    });
    activeStorage.blobs.add(storagePath("owner", "drawing-1", 3, "source.stoneink"));
    activeStorage.blobs.add(storagePath("owner", "drawing-1", 3, "preview.png"));
    activeStorage.blobs.add(storagePath("other", "other-drawing", 1, "source.stoneink"));

    await expect(remote.push(event)).resolves.toMatchObject({ kind: "acknowledged" });
    expect(activeFirestore.get(entityPath("owner", "documents", "note-1"))).toBeUndefined();
    expect(activeFirestore.get(entityPath("owner", "drawings", "drawing-1"))).toBeUndefined();
    expect(activeFirestore.get(entityPath("owner", "documents", "note-2"))).toMatchObject({
      id: "note-2",
    });
    expect(activeFirestore.get(entityPath("other", "documents", "other-note"))).toMatchObject({
      id: "other-note",
    });
    expect(
      activeFirestore.get(entityPath("owner", "deletionTombstones", "document:note-1")),
    ).toMatchObject({ revision: 3, entityType: "document" });
    expect(
      activeFirestore.get(entityPath("owner", "deletionTombstones", "drawing:drawing-1")),
    ).toMatchObject({ revision: 4, entityType: "drawing" });
    expect(activeStorage.blobs).toEqual(
      new Set([storagePath("other", "other-drawing", 1, "source.stoneink")]),
    );

    await expect(remote.push(event)).resolves.toMatchObject({ kind: "acknowledged" });
    await expect(remote.push(staleDocumentUpsert())).rejects.toBeInstanceOf(
      SyncRevisionConflictError,
    );
  });

  it("leaves a remote purge marker after Storage failure and retries it safely", async () => {
    const { FirebaseSyncRemote } = await import("./firestore");
    const remote = new FirebaseSyncRemote();
    const event = permanentDocumentEvent();
    activeFirestore.seed(entityPath("owner", "documents", "note-1"), {
      id: "note-1",
      ownerId: "owner",
      revision: 2,
      idempotencyKey: "device:note-1:2",
    });
    activeFirestore.seed(entityPath("owner", "drawings", "drawing-1"), {
      id: "drawing-1",
      ownerId: "owner",
      revision: 3,
    });
    const sourcePath = storagePath("owner", "drawing-1", 3, "source.stoneink");
    activeStorage.blobs.add(sourcePath);
    activeStorage.blobs.add(storagePath("owner", "drawing-1", 3, "preview.png"));
    activeStorage.failDeletes.add(sourcePath);

    await expect(remote.push(event)).rejects.toMatchObject({
      name: "SyncTransportError",
      retryable: true,
    });
    expect(activeFirestore.get(entityPath("owner", "documents", "note-1"))).toBeUndefined();
    expect(activeFirestore.get(deleteMarkerPath(event.id, "drawing-1"))).toMatchObject({
      state: "pending",
    });

    activeStorage.failDeletes.clear();
    await expect(remote.push(event)).resolves.toMatchObject({ kind: "acknowledged" });
    expect(activeFirestore.get(deleteMarkerPath(event.id, "drawing-1"))).toBeUndefined();
    expect(activeStorage.blobs.size).toBe(0);
  });

  it("keeps a normal soft delete as a recoverable Firestore row", async () => {
    const { FirebaseSyncRemote } = await import("./firestore");
    const remote = new FirebaseSyncRemote();
    const event: OutboxEvent = {
      id: "device:note-1:soft-delete",
      ownerId: "owner",
      entityType: "document",
      entityId: "note-1",
      operation: "delete",
      baseRevision: 1,
      revision: 2,
      payloadVersion: 1,
      payload: {
        id: "note-1",
        ownerId: "owner",
        kind: "note",
        title: "Trash me",
        markdown: "# Trash me",
        path: null,
        projectId: null,
        isPinned: false,
        revision: 2,
        createdAt: "2026-08-18T00:00:00.000Z",
        updatedAt: "2026-08-18T01:00:00.000Z",
        deletedAt: "2026-08-18T01:00:00.000Z",
        updatedByDeviceId: "device",
      },
      createdAt: "2026-08-18T01:00:00.000Z",
      attemptCount: 0,
      nextAttemptAt: null,
      idempotencyKey: "device:note-1:soft-delete",
      lastError: null,
    };
    activeFirestore.seed(entityPath("owner", "documents", "note-1"), {
      id: "note-1",
      ownerId: "owner",
      revision: 1,
      idempotencyKey: "device:note-1:1",
    });

    await expect(remote.push(event)).resolves.toMatchObject({ kind: "acknowledged" });
    expect(activeFirestore.get(entityPath("owner", "documents", "note-1"))).toMatchObject({
      deletedAt: "2026-08-18T01:00:00.000Z",
      revision: 2,
    });
    expect(
      activeFirestore.get(entityPath("owner", "deletionTombstones", "document:note-1")),
    ).toBeUndefined();
  });

  it("builds the next cursor from the eventId field, not the Firestore document id", async () => {
    const { FirebaseSyncRemote } = await import("./firestore");
    const remote = new FirebaseSyncRemote();
    activeFirestore.seed(entityPath("owner", "syncEvents", "firestore-doc-id"), {
      eventId: "event-field-id",
      ownerId: "owner",
      entityType: "document",
      entityId: "note-1",
      operation: "upsert",
      revision: 1,
      payloadVersion: 1,
      payload: { id: "note-1", ownerId: "owner", revision: 1 },
      createdAt: "2026-08-18T00:00:00.000Z",
      idempotencyKey: "event-field-id",
      serverUpdatedAt: new FakeTimestamp(1_750_000_000, 123),
    });

    const page = await remote.pull("owner", null, 1);

    expect(page.changes[0]?.eventId).toBe("event-field-id");
    expect(decodeSyncEventCursor(page.cursor)).toMatchObject({
      serverUpdatedAtSeconds: 1_750_000_000,
      serverUpdatedAtNanoseconds: 123,
      eventId: "event-field-id",
    });
  });

  it("keeps equal-timestamp events deterministic across real remote page boundaries", async () => {
    const { FirebaseSyncRemote } = await import("./firestore");
    const remote = new FirebaseSyncRemote();
    for (const eventId of ["event-z", "event-a", "event-m"]) {
      activeFirestore.seed(entityPath("owner", "syncEvents", eventId), {
        eventId,
        ownerId: "owner",
        entityType: "document",
        entityId: eventId,
        operation: "upsert",
        revision: 1,
        payloadVersion: 1,
        payload: { id: eventId, ownerId: "owner", revision: 1 },
        createdAt: "2026-08-18T00:00:00.000Z",
        idempotencyKey: eventId,
        serverUpdatedAt: new FakeTimestamp(1_750_000_000, 123),
      });
    }

    const firstPage = await remote.pull("owner", null, 2);
    const secondPage = await remote.pull("owner", firstPage.cursor, 2);

    expect(firstPage.changes.map((change) => change.eventId)).toEqual(["event-a", "event-m"]);
    expect(secondPage.changes.map((change) => change.eventId)).toEqual(["event-z"]);
    expect(secondPage.hasMore).toBe(false);
  });
});

class FakeFirestoreState {
  public readonly documents = new Map<string, StoredDocument>();
  public readonly failDeletes = new Set<string>();
  public nextTransactionError: Error | null = null;
  public readonly module = new FakeFirestoreModule(this);

  public seed(path: string, value: StoredDocument): void {
    this.documents.set(path, cloneDocument(value));
  }

  public get(path: string): StoredDocument | undefined {
    const value = this.documents.get(path);
    return value ? cloneDocument(value) : undefined;
  }

  public write(
    reference: FakeDocumentReference,
    value: StoredDocument,
    options?: FirestoreWriteOptions,
  ): void {
    const materialized = materialize(value) as StoredDocument;
    const existing = this.documents.get(reference.path);
    this.documents.set(
      reference.path,
      options?.merge && existing ? { ...existing, ...materialized } : materialized,
    );
  }

  public delete(reference: FakeDocumentReference): void {
    this.documents.delete(reference.path);
  }

  public immediateDocuments(collectionPath: string): readonly FakeDocumentReference[] {
    const prefix = `${collectionPath}/`;
    return [...this.documents.keys()]
      .filter((path) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
      .map((path) => new FakeDocumentReference(this, path));
  }
}

class FakeFirestoreModule {
  public constructor(private readonly state: FakeFirestoreState) {}

  public collection(name: string): FakeCollectionReference {
    return new FakeCollectionReference(this.state, name);
  }

  public async runTransaction<T>(
    operation: (transaction: FakeTransaction) => Promise<T>,
  ): Promise<T> {
    const transaction = new FakeTransaction(this.state);
    const result = await operation(transaction);
    if (this.state.nextTransactionError) {
      const error = this.state.nextTransactionError;
      this.state.nextTransactionError = null;
      throw error;
    }
    transaction.commit();
    return result;
  }
}

class FakeTransaction {
  private readonly writes: FakeWrite[] = [];

  public constructor(private readonly state: FakeFirestoreState) {}

  public get(reference: FakeDocumentReference): Promise<FakeSnapshot> {
    return reference.get();
  }

  public set(
    reference: FakeDocumentReference,
    value: StoredDocument,
    options?: FirestoreWriteOptions,
  ): void {
    this.writes.push({ kind: "set", reference, value, options });
  }

  public delete(reference: FakeDocumentReference): void {
    this.writes.push({ kind: "delete", reference });
  }

  public commit(): void {
    for (const write of this.writes) {
      if (write.kind === "delete") this.state.delete(write.reference);
      else this.state.write(write.reference, write.value, write.options);
    }
  }
}

type FakeWrite =
  | {
      kind: "set";
      reference: FakeDocumentReference;
      value: StoredDocument;
      options: FirestoreWriteOptions | undefined;
    }
  | { kind: "delete"; reference: FakeDocumentReference };

class FakeCollectionReference {
  public constructor(
    private readonly state: FakeFirestoreState,
    private readonly path: string,
  ) {}

  public doc(id: string): FakeDocumentReference {
    return new FakeDocumentReference(this.state, `${this.path}/${id}`);
  }

  public orderBy(field: string, direction?: string): FakeQuery {
    return new FakeQuery(this.state, this.path).orderBy(field, direction);
  }

  public limit(count: number): FakeQuery {
    return new FakeQuery(this.state, this.path).limit(count);
  }

  public get(): Promise<FakeQuerySnapshot> {
    return new FakeQuery(this.state, this.path).get();
  }
}

class FakeQuery {
  private readonly orderings: readonly { field: string; direction: string }[];
  private readonly count: number | null;
  private readonly afterValues: readonly unknown[] | null;

  public constructor(
    private readonly state: FakeFirestoreState,
    private readonly path: string,
    orderings: readonly { field: string; direction: string }[] = [],
    count: number | null = null,
    afterValues: readonly unknown[] | null = null,
  ) {
    this.orderings = orderings;
    this.count = count;
    this.afterValues = afterValues;
  }

  public orderBy(field: string, direction = "asc"): FakeQuery {
    return new FakeQuery(
      this.state,
      this.path,
      [...this.orderings, { field, direction }],
      this.count,
      this.afterValues,
    );
  }

  public limit(count: number): FakeQuery {
    return new FakeQuery(this.state, this.path, this.orderings, count, this.afterValues);
  }

  public startAfter(...values: unknown[]): FakeQuery {
    return new FakeQuery(this.state, this.path, this.orderings, this.count, values);
  }

  public get(): Promise<FakeQuerySnapshot> {
    let documents = [...this.state.immediateDocuments(this.path)];
    documents.sort((left, right) => {
      for (const ordering of this.orderings) {
        const leftValue = left.data()?.[ordering.field];
        const rightValue = right.data()?.[ordering.field];
        const result = compareFakeValues(leftValue, rightValue);
        if (result === 0) continue;
        return ordering.direction === "desc" ? -result : result;
      }
      return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
    });
    const afterValues = this.afterValues;
    if (afterValues) {
      documents = documents.filter((document) => {
        const data = document.data() ?? {};
        for (let index = 0; index < this.orderings.length; index += 1) {
          const ordering = this.orderings[index];
          const afterValue = afterValues[index];
          if (!ordering) continue;
          const result = compareFakeValues(data[ordering.field], afterValue);
          if (result === 0) continue;
          return ordering.direction === "desc" ? result < 0 : result > 0;
        }
        return false;
      });
    }
    if (this.count !== null) documents = documents.slice(0, this.count);
    return Promise.resolve(new FakeQuerySnapshot(documents));
  }
}

class FakeDocumentReference {
  public readonly id: string;
  public readonly ref = this;

  public constructor(
    private readonly state: FakeFirestoreState,
    public readonly path: string,
  ) {
    this.id = path.slice(path.lastIndexOf("/") + 1);
  }

  public collection(name: string): FakeCollectionReference {
    return new FakeCollectionReference(this.state, `${this.path}/${name}`);
  }

  public get(): Promise<FakeSnapshot> {
    return Promise.resolve(new FakeSnapshot(this.id, this.state.get(this.path)));
  }

  public set(value: StoredDocument, options?: FirestoreWriteOptions): Promise<void> {
    this.state.write(this, value, options);
    return Promise.resolve();
  }

  public delete(): Promise<void> {
    if (this.state.failDeletes.has(this.path)) {
      const error = new Error("firestore/delete-failed") as Error & { code: string };
      error.code = "firestore/delete-failed";
      return Promise.reject(error);
    }
    this.state.delete(this);
    return Promise.resolve();
  }

  public data(): StoredDocument | undefined {
    return this.state.get(this.path);
  }
}

class FakeSnapshot {
  public constructor(
    public readonly id: string,
    private readonly value: StoredDocument | undefined,
  ) {}

  public exists(): boolean {
    return this.value !== undefined;
  }

  public data(): StoredDocument | undefined {
    return this.value ? cloneDocument(this.value) : undefined;
  }
}

class FakeQuerySnapshot {
  public constructor(public readonly docs: readonly FakeDocumentReference[]) {}
}

class FakeStorageState {
  public readonly blobs = new Set<string>();
  public readonly uploads: string[] = [];
  public readonly deletes: string[] = [];
  public readonly failUploads = new Set<string>();
  public readonly failDeletes = new Set<string>();
  public readonly module = { ref: (path: string) => new FakeStorageReference(this, path) };
}

class FakeStorageReference {
  public constructor(
    private readonly state: FakeStorageState,
    public readonly path: string,
  ) {}

  public putFile(): Promise<void> {
    if (this.state.failUploads.has(this.path)) throw new FakeStorageError("storage/upload-failed");
    if (this.state.blobs.has(this.path)) throw new FakeStorageError("storage/object-exists");
    this.state.uploads.push(this.path);
    this.state.blobs.add(this.path);
    return Promise.resolve();
  }

  public delete(): Promise<void> {
    if (this.state.failDeletes.has(this.path)) throw new FakeStorageError("storage/delete-failed");
    if (!this.state.blobs.delete(this.path)) throw new FakeStorageError("storage/object-not-found");
    this.state.deletes.push(this.path);
    return Promise.resolve();
  }

  public getDownloadURL(): Promise<string> {
    return Promise.resolve(`https://storage.test/${encodeURIComponent(this.path)}`);
  }

  public listAll(): Promise<{
    prefixes: readonly FakeStorageReference[];
    items: readonly FakeStorageReference[];
  }> {
    const prefix = `${this.path}/`;
    const prefixes = new Set<string>();
    const items: FakeStorageReference[] = [];
    for (const blob of this.state.blobs) {
      if (!blob.startsWith(prefix)) continue;
      const rest = blob.slice(prefix.length);
      const separator = rest.indexOf("/");
      if (separator < 0) items.push(new FakeStorageReference(this.state, blob));
      else prefixes.add(`${prefix}${rest.slice(0, separator)}`);
    }
    return Promise.resolve({
      prefixes: [...prefixes].map((path) => new FakeStorageReference(this.state, path)),
      items,
    });
  }
}

class FakeStorageError extends Error {
  public constructor(public readonly code: string) {
    super(code);
  }
}

function cloneDocument(value: StoredDocument): StoredDocument {
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneValue(entry)]));
}

function cloneValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        cloneValue(entry),
      ]),
    );
  }
  return value;
}

function materialize(value: unknown): unknown {
  if (value === SERVER_TIMESTAMP) return new FakeTimestamp(1_750_000_000, 123_000_000);
  if (Array.isArray(value)) return value.map(materialize);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        materialize(entry),
      ]),
    );
  }
  return value;
}

function compareFakeValues(left: unknown, right: unknown): number {
  if (left === right) return 0;
  if (left === undefined || left === null) return -1;
  if (right === undefined || right === null) return 1;
  if (typeof left === "number" && typeof right === "number") return left < right ? -1 : 1;
  const leftText = JSON.stringify(left) ?? "";
  const rightText = JSON.stringify(right) ?? "";
  if (leftText === rightText) return 0;
  return leftText < rightText ? -1 : 1;
}

function entityPath(ownerId: string, collection: string, entityId: string): string {
  return `users/${ownerId}/${collection}/${entityId}`;
}

function collectionPath(ownerId: string, collection: string): string {
  return `users/${ownerId}/${collection}`;
}

function uploadMarkerPath(eventId: string): string {
  return collectionPath("owner", "drawingOperations") + `/upload:${encodeURIComponent(eventId)}`;
}

function deleteMarkerPath(eventId: string, drawingId: string): string {
  return (
    collectionPath("owner", "drawingOperations") +
    `/delete:${encodeURIComponent(`${eventId}:${drawingId}`)}`
  );
}

function drawingEvent(
  options: {
    baseRevision?: number;
    revision?: number;
    createdAt?: string;
    id?: string;
  } = {},
): OutboxEvent {
  const revision = options.revision ?? 1;
  return {
    id: options.id ?? `device:drawing-1:${revision}`,
    ownerId: "owner",
    entityType: "drawing",
    entityId: "drawing-1",
    operation: "upsert",
    baseRevision: options.baseRevision ?? 0,
    revision,
    payloadVersion: 1,
    payload: {
      id: "drawing-1",
      ownerId: "owner",
      documentId: "note-1",
      title: "Sketch",
      sourcePath: "file:///local/source.stoneink",
      previewPath: "file:///local/preview.png",
      sourceSha256: "source",
      previewSha256: "preview",
      sourceSize: 1,
      previewSize: 1,
      revision,
      createdAt: "2026-08-18T00:00:00.000Z",
      updatedAt: "2026-08-18T01:00:00.000Z",
      deletedAt: null,
      updatedByDeviceId: "device",
    },
    createdAt: options.createdAt ?? "2026-08-18T01:00:00.000Z",
    attemptCount: 0,
    nextAttemptAt: null,
    idempotencyKey: options.id ?? `device:drawing-1:${revision}`,
    lastError: null,
  };
}

function drawingRemoteChange(event: OutboxEvent): RemoteChange {
  return {
    eventId: "other-device:drawing-1:1",
    ownerId: event.ownerId,
    entityType: "drawing",
    entityId: event.entityId,
    operation: "upsert",
    revision: 1,
    payloadVersion: 1,
    payload: {
      ...event.payload,
      revision: 1,
      sourceStoragePath: storagePath("owner", "drawing-1", 1, "source.stoneink"),
      previewStoragePath: storagePath("owner", "drawing-1", 1, "preview.png"),
    },
    createdAt: "2026-08-18T00:00:00.000Z",
    idempotencyKey: "other-device:drawing-1:1",
  };
}

function permanentDocumentEvent(): OutboxEvent {
  return {
    id: "device:document:note-1:purge:3",
    ownerId: "owner",
    entityType: "document",
    entityId: "note-1",
    operation: "delete",
    baseRevision: 2,
    revision: 3,
    payloadVersion: 1,
    payload: {
      id: "note-1",
      ownerId: "owner",
      revision: 3,
      deletedAt: "2026-08-18T02:00:00.000Z",
      updatedAt: "2026-08-18T02:00:00.000Z",
      updatedByDeviceId: "device",
      purge: true,
      cascadeDrawingIds: ["drawing-1"],
    },
    createdAt: "2026-08-18T02:00:00.000Z",
    attemptCount: 0,
    nextAttemptAt: null,
    idempotencyKey: "device:document:note-1:purge:3",
    lastError: null,
  };
}

function staleDocumentUpsert(): OutboxEvent {
  return {
    id: "stale-device:document:note-1:4",
    ownerId: "owner",
    entityType: "document",
    entityId: "note-1",
    operation: "upsert",
    baseRevision: 3,
    revision: 4,
    payloadVersion: 1,
    payload: {
      id: "note-1",
      ownerId: "owner",
      kind: "note",
      title: "Stale copy",
      markdown: "# Stale copy",
      path: null,
      projectId: null,
      isPinned: false,
      revision: 4,
      createdAt: "2026-08-18T00:00:00.000Z",
      updatedAt: "2026-08-18T03:00:00.000Z",
      deletedAt: null,
      updatedByDeviceId: "stale-device",
    },
    createdAt: "2026-08-18T03:00:00.000Z",
    attemptCount: 0,
    nextAttemptAt: null,
    idempotencyKey: "stale-device:document:note-1:4",
    lastError: null,
  };
}
