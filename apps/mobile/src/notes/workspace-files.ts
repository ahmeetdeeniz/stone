import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import type { ExportedProjectFile } from "@stone/domain";
import { sanitizeFileName, serializeProjectExport } from "@stone/markdown";

export async function shareWorkspaceExport(files: readonly ExportedProjectFile[]): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new Error("Paylaşım bu cihazda kullanılamıyor.");
  const file = new File(
    Paths.cache,
    `${sanitizeFileName("stone-workspace", "stone-workspace")}-export.md`,
  );
  file.write(serializeProjectExport(files));
  await Sharing.shareAsync(file.uri, {
    mimeType: "text/markdown",
    dialogTitle: "Stone workspace dışa aktarımı",
    UTI: "net.daringfireball.markdown",
  });
}
