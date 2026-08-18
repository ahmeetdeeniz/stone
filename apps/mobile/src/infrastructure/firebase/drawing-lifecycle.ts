export interface DrawingUploadLifecycle<T> {
  createPending(): Promise<void>;
  upload(): Promise<T>;
  commit(payload: T): Promise<void>;
  isCommitted(): Promise<boolean>;
  deleteUploaded(payload: T | undefined, operationError: unknown): Promise<void>;
  removeMarker(): Promise<void>;
}

export class DrawingUploadCleanupError extends Error {
  public readonly operationError: unknown;
  public readonly cleanupError: unknown;

  public constructor(operationError: unknown, cleanupError: unknown) {
    super(
      `Drawing upload failed and cleanup also failed: ${errorMessage(operationError)}; cleanup: ${errorMessage(cleanupError)}`,
    );
    this.name = "DrawingUploadCleanupError";
    this.operationError = operationError;
    this.cleanupError = cleanupError;
  }
}

export async function runDrawingUpload<T>(lifecycle: DrawingUploadLifecycle<T>): Promise<T> {
  await lifecycle.createPending();
  let committedInProcess = false;
  let uploadedPayload: T | undefined;
  try {
    uploadedPayload = await lifecycle.upload();
    await lifecycle.commit(uploadedPayload);
    committedInProcess = true;
    await lifecycle.removeMarker();
    return uploadedPayload;
  } catch (operationError) {
    if (committedInProcess) throw operationError;

    let committedRemotely = false;
    try {
      committedRemotely = await lifecycle.isCommitted();
    } catch (checkError) {
      throw new DrawingUploadCleanupError(operationError, checkError);
    }
    if (committedRemotely) throw operationError;

    try {
      await lifecycle.deleteUploaded(uploadedPayload, operationError);
    } catch (cleanupError) {
      throw new DrawingUploadCleanupError(operationError, cleanupError);
    }
    try {
      await lifecycle.removeMarker();
    } catch (cleanupError) {
      throw new DrawingUploadCleanupError(operationError, cleanupError);
    }
    throw operationError;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}
