import * as DocumentPicker from "expo-document-picker";
import * as Sharing from "expo-sharing";
import { ATTACHMENT_MIME_TYPES, AttachmentError, attachmentTypeOf } from "@stone/markdown";
import type { PickedAttachment } from "./attachment-service";

/** Lets the user pick one image or PDF; null when they cancel. */
export async function pickAttachment(): Promise<PickedAttachment | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: [...ATTACHMENT_MIME_TYPES],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  if (!asset) return null;
  return {
    uri: asset.uri,
    name: asset.name,
    mimeType: asset.mimeType ?? null,
    size: asset.size ?? null,
  };
}

/** Lets the user pick one photo (for a notebook page); null when they cancel. */
export async function pickImage(): Promise<PickedAttachment | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ATTACHMENT_MIME_TYPES.filter((type) => type.startsWith("image/")),
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  if (!asset) return null;
  return {
    uri: asset.uri,
    name: asset.name,
    mimeType: asset.mimeType ?? null,
    size: asset.size ?? null,
  };
}

/** Lets the user pick one PDF (lecture slides to write on); null when they cancel. */
export async function pickPdf(): Promise<PickedAttachment | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ["application/pdf"],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  if (!asset) return null;
  return {
    uri: asset.uri,
    name: asset.name,
    mimeType: asset.mimeType ?? "application/pdf",
    size: asset.size ?? null,
  };
}

/** Hands a local attachment to the system (Quick Look / an installed viewer, or share). */
export async function openAttachmentExternally(uri: string, fileName: string): Promise<void> {
  const type = attachmentTypeOf(fileName);
  await Sharing.shareAsync(uri, {
    ...(type ? { mimeType: type.mimeType } : {}),
    ...(type?.kind === "pdf" ? { UTI: "com.adobe.pdf" } : {}),
  });
}

/** i18n key for a failed attachment, so the alert explains what to change. */
export function attachmentErrorKey(
  error: unknown,
): "attachments.tooLarge" | "attachments.empty" | "attachments.unsupported" | null {
  if (!(error instanceof AttachmentError)) return null;
  return error.code === "too-large"
    ? "attachments.tooLarge"
    : error.code === "empty"
      ? "attachments.empty"
      : "attachments.unsupported";
}
