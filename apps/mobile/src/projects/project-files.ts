import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { sanitizeFileName } from "@stone/markdown";
import type { ExportedProjectFile } from "@stone/domain";

export async function shareProjectExport(
  slug: string,
  files: readonly ExportedProjectFile[],
): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new Error("Paylaşım bu cihazda kullanılamıyor.");
  const content = files
    .map((file) => `<!-- stone-export-path: ${file.path} -->\n\n${file.content}`)
    .join("\n\n---\n\n");
  const file = new File(Paths.cache, `${sanitizeFileName(slug, "project")}-export.md`);
  file.write(content);
  await Sharing.shareAsync(file.uri, {
    mimeType: "text/markdown",
    dialogTitle: `${slug} proje Markdown dışa aktarımı`,
    UTI: "net.daringfireball.markdown",
  });
}
