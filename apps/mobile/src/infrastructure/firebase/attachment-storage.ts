import storage from "@react-native-firebase/storage";
import { File } from "expo-file-system";
import { attachmentStoragePath, attachmentTypeOf } from "@stone/markdown";
import type { AttachmentRemote } from "../../attachments/attachment-service";
import { deleteStorageTree, isStorageNotFoundError } from "./storage";

/** Note attachments in Firebase Storage under `users/{uid}/attachments/{sha256}.{ext}`. */
export class FirebaseAttachmentStorage implements AttachmentRemote {
  public async upload(ownerId: string, fileName: string, localUri: string): Promise<void> {
    const type = attachmentTypeOf(fileName);
    if (!type) throw new Error("Attachment file name is invalid.");
    const reference = storage().ref(attachmentStoragePath(ownerId, fileName));
    // Objects are immutable (the rules reject overwrites) and named by content hash, so an
    // existing object is already this exact file.
    if (await exists(reference)) return;
    try {
      await reference.putFile(localUri, { contentType: type.mimeType });
    } catch (error) {
      // Another device may have uploaded the same file between the check and the write.
      if (await exists(reference)) return;
      throw error;
    }
  }

  public async download(ownerId: string, fileName: string, targetUri: string): Promise<void> {
    const reference = storage().ref(attachmentStoragePath(ownerId, fileName));
    await File.downloadFileAsync(await reference.getDownloadURL(), new File(targetUri), {
      idempotent: true,
    });
  }

  public async deleteOwnerAttachments(ownerId: string): Promise<void> {
    await deleteStorageTree(storage().ref(`users/${ownerId}/attachments`));
  }
}

async function exists(reference: ReturnType<ReturnType<typeof storage>["ref"]>): Promise<boolean> {
  try {
    await reference.getMetadata();
    return true;
  } catch (error) {
    if (isStorageNotFoundError(error)) return false;
    throw error;
  }
}
