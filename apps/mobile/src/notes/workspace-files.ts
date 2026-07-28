import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import type { ExportedProjectFile } from "@stone/domain";
import { sanitizeFileName } from "@stone/markdown";
import { serializeWorkspaceBundle } from "./workspace-bundle";

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
