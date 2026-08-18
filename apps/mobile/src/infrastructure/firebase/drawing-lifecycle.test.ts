import { describe, expect, it } from "vitest";
import { DrawingUploadCleanupError, runDrawingUpload } from "./drawing-lifecycle";

interface FakeLifecycle {
  calls: string[];
  committed: boolean;
  deleted: boolean;
  marker: "pending" | "removed";
  commitError: Error | null;
  deleteError: Error | null;
  removeMarkerError: Error | null;
}

function fakeLifecycle(): FakeLifecycle {
  return {
    calls: [],
    committed: false,
    deleted: false,
    marker: "pending",
    commitError: null,
    deleteError: null,
    removeMarkerError: null,
  };
}

describe("drawing upload lifecycle", () => {
  it("removes the marker after a committed upload without deleting blobs", async () => {
    const state = fakeLifecycle();
    await runDrawingUpload({
      createPending: () => {
        state.calls.push("pending");
        return Promise.resolve();
      },
      upload: () => {
        state.calls.push("upload");
        return Promise.resolve("metadata");
      },
      commit: () => {
        state.calls.push("commit");
        state.committed = true;
        return Promise.resolve();
      },
      isCommitted: () => Promise.resolve(state.committed),
      deleteUploaded: () => {
        state.calls.push("delete");
        state.deleted = true;
        return Promise.resolve();
      },
      removeMarker: () => {
        state.calls.push("remove-marker");
        state.marker = "removed";
        return Promise.resolve();
      },
    });

    expect(state.calls).toEqual(["pending", "upload", "commit", "remove-marker"]);
    expect(state.deleted).toBe(false);
    expect(state.marker).toBe("removed");
  });

  it("compensates immutable blobs when metadata commit fails", async () => {
    const state = fakeLifecycle();
    state.commitError = new Error("Firestore unavailable");

    await expect(
      runDrawingUpload({
        createPending: () => {
          state.calls.push("pending");
          return Promise.resolve();
        },
        upload: () => {
          state.calls.push("upload");
          return Promise.resolve("metadata");
        },
        commit: () => {
          state.calls.push("commit");
          return Promise.reject(state.commitError ?? new Error("Missing commit error"));
        },
        isCommitted: () => Promise.resolve(state.committed),
        deleteUploaded: () => {
          state.calls.push("delete");
          state.deleted = true;
          return Promise.resolve();
        },
        removeMarker: () => {
          state.calls.push("remove-marker");
          state.marker = "removed";
          return Promise.resolve();
        },
      }),
    ).rejects.toThrow("Firestore unavailable");

    expect(state.calls).toEqual(["pending", "upload", "commit", "delete", "remove-marker"]);
    expect(state.deleted).toBe(true);
    expect(state.marker).toBe("removed");
  });

  it("keeps the marker when cleanup fails so a later reconciliation can retry", async () => {
    const state = fakeLifecycle();
    state.commitError = new Error("Firestore unavailable");
    state.deleteError = new Error("Storage unavailable");

    await expect(
      runDrawingUpload({
        createPending: () => {
          state.calls.push("pending");
          return Promise.resolve();
        },
        upload: () => Promise.resolve("metadata"),
        commit: () => {
          return Promise.reject(state.commitError ?? new Error("Missing commit error"));
        },
        isCommitted: () => Promise.resolve(state.committed),
        deleteUploaded: () => {
          state.calls.push("delete");
          return Promise.reject(state.deleteError ?? new Error("Missing delete error"));
        },
        removeMarker: () => {
          state.calls.push("remove-marker");
          state.marker = "removed";
          return Promise.resolve();
        },
      }),
    ).rejects.toBeInstanceOf(DrawingUploadCleanupError);

    expect(state.marker).toBe("pending");
    expect(state.calls).toEqual(["pending", "delete"]);
  });

  it("does not delete blobs when the transaction committed but returned an error", async () => {
    const state = fakeLifecycle();
    state.committed = true;
    const commitError = new Error("transaction response lost");

    await expect(
      runDrawingUpload({
        createPending: () => Promise.resolve(),
        upload: () => Promise.resolve("metadata"),
        commit: () => Promise.reject(commitError),
        isCommitted: () => Promise.resolve(state.committed),
        deleteUploaded: () => {
          state.deleted = true;
          return Promise.resolve();
        },
        removeMarker: () => Promise.resolve(),
      }),
    ).rejects.toBe(commitError);

    expect(state.deleted).toBe(false);
  });
});
