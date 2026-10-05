import * as Crypto from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";
import {
  assertAttachmentSize,
  attachmentFileName,
  isAttachmentFileName,
  resolveAttachmentType,
} from "@stone/markdown";
import type { AttachmentFiles, PickedAttachment } from "./attachment-service";

/** `<documents>/attachments/<ownerId>/`, so purging an account removes exactly its files. */
export function attachmentDirectory(ownerId: string): Directory {
  if (!ownerId || ownerId.includes("/") || ownerId.includes("..")) {
    throw new Error("Attachment owner id is invalid.");
  }
  return new Directory(Paths.document, "attachments", ownerId);
}

export function localAttachmentFile(ownerId: string, fileName: string): File {
  if (!isAttachmentFileName(fileName)) throw new Error("Attachment file name is invalid.");
  return new File(attachmentDirectory(ownerId), fileName);
}

export const expoAttachmentFiles: AttachmentFiles = {
  async import(ownerId: string, picked: PickedAttachment): Promise<string> {
    const type = resolveAttachmentType(picked.name, picked.mimeType);
    const source = new File(picked.uri);
    if (picked.size) assertAttachmentSize(picked.size);
    const bytes = await source.bytes();
    assertAttachmentSize(bytes.byteLength);
    const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes);
    const fileName = attachmentFileName(toHex(new Uint8Array(digest)), type);
    const target = localAttachmentFile(ownerId, fileName);
    if (!target.exists) {
      attachmentDirectory(ownerId).create({ idempotent: true, intermediates: true });
      target.write(bytes);
    }
    return fileName;
  },
  localUri(ownerId: string, fileName: string): string | null {
    const file = localAttachmentFile(ownerId, fileName);
    return file.exists && file.size > 0 ? file.uri : null;
  },
  targetUri(ownerId: string, fileName: string): string {
    attachmentDirectory(ownerId).create({ idempotent: true, intermediates: true });
    return localAttachmentFile(ownerId, fileName).uri;
  },
};

/** Deletes every local attachment of an account (used when its data is purged). */
export function deleteLocalAttachments(ownerId: string): void {
  const directory = attachmentDirectory(ownerId);
  if (directory.exists) directory.delete();
}

/** Base64 content of a local attachment, or null when it is not on this device. */
export async function readLocalAttachmentBase64(
  ownerId: string,
  fileName: string,
): Promise<string | null> {
  const file = localAttachmentFile(ownerId, fileName);
  return file.exists ? file.base64() : null;
}

/** Writes an attachment from base64 (workspace restore). Returns false when it already existed. */
export function writeLocalAttachmentBase64(
  ownerId: string,
  fileName: string,
  base64: string,
): boolean {
  const file = localAttachmentFile(ownerId, fileName);
  if (file.exists) return false;
  attachmentDirectory(ownerId).create({ idempotent: true, intermediates: true });
  file.write(base64, { encoding: "base64" });
  return true;
}

function toHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex;
}
