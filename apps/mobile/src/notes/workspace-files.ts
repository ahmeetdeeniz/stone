import * as DocumentPicker from "expo-document-picker";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import type { ExportedProjectFile } from "@stone/domain";
import { sanitizeFileName } from "@stone/markdown";
import { parseWorkspaceBundle, serializeWorkspaceBundle } from "./workspace-bundle";

const MAX_WORKSPACE_BYTES = 20_000_000;

export async function shareWorkspaceExport(files: readonly ExportedProjectFile[]): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new Error("Paylaşım bu cihazda kullanılamıyor.");
  const file = new File(
    Paths.cache,
    `${sanitizeFileName("stone-workspace", "stone-workspace")}-export.stone-workspace.json`,
  );
  file.write(serializeWorkspaceBundle(files));
  await Sharing.shareAsync(file.uri, {
    mimeType: "application/json",
    dialogTitle: "Stone workspace dışa aktarımı",
    UTI: "public.json",
  });
}

export async function pickWorkspaceCalendarFile(): Promise<string | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ["application/json", "application/octet-stream"],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  if (!asset) return null;
  if (asset.size != null && asset.size > MAX_WORKSPACE_BYTES)
    throw new Error("Workspace file is too large.");
  const file = new File(asset.uri);
  const bytes = await file.bytes();
  if (bytes.byteLength > MAX_WORKSPACE_BYTES) throw new Error("Workspace file is too large.");
  const files = parseWorkspaceBundle(await file.text());
  const calendar = files.find((entry) => entry.path === "calendar.json");
  if (!calendar || calendar.encoding !== "utf8")
    throw new Error("Workspace does not contain a readable calendar.json file.");
  return calendar.content;
}
