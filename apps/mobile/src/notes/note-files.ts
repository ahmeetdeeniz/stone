import * as DocumentPicker from "expo-document-picker";
import { File, Paths } from "expo-file-system";
import * as Crypto from "expo-crypto";
import * as Sharing from "expo-sharing";
import type { Document, NoteUseCases } from "@stone/domain";
import { normalizeMarkdown, sanitizeFileName, validateImportFile } from "@stone/markdown";

export async function pickAndImportNote(
  ownerId: string,
  deviceId: string,
  noteUseCases: NoteUseCases,
): Promise<Document | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ["text/markdown", "text/plain", "application/octet-stream"],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  if (!asset) return null;
  const bytes = await new File(asset.uri).bytes();
  const markdown = validateImportFile(asset.name, bytes);
  const title = titleFromFileName(asset.name);
  const now = new Date().toISOString();
  return noteUseCases.create({
    id: Crypto.randomUUID(),
    ownerId,
    kind: "note",
    title,
    markdown,
    path: asset.name,
    projectId: null,
    isPinned: false,
    revision: 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    updatedByDeviceId: deviceId,
  });
}

export async function exportNote(document: Document): Promise<void> {
  if (!(await Sharing.isAvailableAsync()))
    throw new Error("Sharing is not available on this device.");
  const file = new File(Paths.cache, `${sanitizeFileName(document.title)}.md`);
  file.write(normalizeMarkdown(document.markdown));
  await Sharing.shareAsync(file.uri, {
    mimeType: "text/markdown",
    dialogTitle: `${document.title}.md dosyasını dışa aktar`,
    UTI: "net.daringfireball.markdown",
  });
}

export function titleFromFileName(name: string): string {
  const withoutExtension = name.replace(/\.(?:markdown|md)$/iu, "");
  return sanitizeFileName(withoutExtension, "Untitled note");
}
