import { isAttachmentFileName } from "@stone/markdown";

/** A file the user picked, as the document picker reports it. */
export interface PickedAttachment {
  uri: string;
  name: string;
  mimeType?: string | null;
  size?: number | null;
}

/** On-device attachment files, kept per owner under the app's documents directory. */
export interface AttachmentFiles {
  /** Copies a picked file into the owner's store under its content hash; returns the name. */
  import(ownerId: string, picked: PickedAttachment): Promise<string>;
  /** Local URI of the file, or null when it is not on this device yet. */
  localUri(ownerId: string, fileName: string): string | null;
  /** Where a download for this file should be written. */
  targetUri(ownerId: string, fileName: string): string;
}

/** Remote copy in Firebase Storage. */
export interface AttachmentRemote {
  upload(ownerId: string, fileName: string, localUri: string): Promise<void>;
  download(ownerId: string, fileName: string, targetUri: string): Promise<void>;
}

/** Durable list of attachments that still need uploading. */
export interface AttachmentUploadQueue {
  enqueue(ownerId: string, fileName: string): Promise<void>;
  pending(ownerId: string, limit: number): Promise<readonly string[]>;
  markUploaded(ownerId: string, fileName: string): Promise<void>;
  markFailed(ownerId: string, fileName: string, error: string): Promise<void>;
}

export interface FlushResult {
  uploaded: number;
  failed: number;
}

const FLUSH_BATCH = 25;

/**
 * Adds attachments to the local store and keeps Firebase Storage in step with it. Uploads go
 * through a durable queue so an attachment added offline is uploaded on a later sync, and
 * downloads happen lazily the first time a note that references the file is opened.
 */
export class AttachmentService {
  private readonly downloads = new Map<string, Promise<string>>();
  private readonly flushes = new Map<string, Promise<FlushResult>>();

  public constructor(
    private readonly files: AttachmentFiles,
    private readonly remote: AttachmentRemote,
    private readonly queue: AttachmentUploadQueue,
  ) {}

  /** Stores a picked file and queues it for upload. Returns its content-addressed file name. */
  public async add(ownerId: string, picked: PickedAttachment): Promise<string> {
    const fileName = await this.files.import(ownerId, picked);
    await this.queue.enqueue(ownerId, fileName);
    return fileName;
  }

  /** Queues a file that is already in the local store (for example restored from an export). */
  public async enqueueExisting(ownerId: string, fileName: string): Promise<void> {
    if (!isAttachmentFileName(fileName)) throw new Error("Attachment file name is invalid.");
    await this.queue.enqueue(ownerId, fileName);
  }

  /** Uploads queued attachments. Never throws for a single file; failures stay queued. */
  public flush(ownerId: string): Promise<FlushResult> {
    const running = this.flushes.get(ownerId);
    if (running) return running;
    const run = this.runFlush(ownerId).finally(() => this.flushes.delete(ownerId));
    this.flushes.set(ownerId, run);
    return run;
  }

  /** Local URI for an attachment, downloading it first when this device does not have it. */
  public resolve(ownerId: string, fileName: string): Promise<string> {
    if (!isAttachmentFileName(fileName)) {
      return Promise.reject(new Error("Attachment file name is invalid."));
    }
    const local = this.files.localUri(ownerId, fileName);
    if (local) return Promise.resolve(local);
    const key = `${ownerId}/${fileName}`;
    const running = this.downloads.get(key);
    if (running) return running;
    const target = this.files.targetUri(ownerId, fileName);
    const download = this.remote
      .download(ownerId, fileName, target)
      .then(() => this.files.localUri(ownerId, fileName) ?? target)
      .finally(() => this.downloads.delete(key));
    this.downloads.set(key, download);
    return download;
  }

  private async runFlush(ownerId: string): Promise<FlushResult> {
    const result: FlushResult = { uploaded: 0, failed: 0 };
    for (const fileName of await this.queue.pending(ownerId, FLUSH_BATCH)) {
      const local = this.files.localUri(ownerId, fileName);
      if (!local) {
        // The file was removed locally (for example by a purge); nothing left to upload.
        await this.queue.markUploaded(ownerId, fileName);
        continue;
      }
      try {
        await this.remote.upload(ownerId, fileName, local);
        await this.queue.markUploaded(ownerId, fileName);
        result.uploaded += 1;
      } catch (error) {
        await this.queue.markFailed(
          ownerId,
          fileName,
          error instanceof Error ? error.message : "Upload failed.",
        );
        result.failed += 1;
      }
    }
    return result;
  }
}
