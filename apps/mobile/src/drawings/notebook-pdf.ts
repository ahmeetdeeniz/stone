import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import type { InkNotebook } from "@stone/ink";
import { renderPagePng, type PageAssets } from "./page-picture";
import { assemblePdf, exportScale, pdfFileName } from "./pdf-assembly";

/** Renders every page (paper, photos, text and ink) and opens the share sheet with the PDF. */
export async function shareNotebookPdf(
  notebook: InkNotebook,
  title: string,
  assets: PageAssets,
): Promise<void> {
  const pages = notebook.pages.map((page) => {
    const png = renderPagePng(
      page,
      notebook.paper,
      notebook.pageWidth,
      assets,
      exportScale(page.height),
    );
    if (!png) throw new Error("A page could not be rendered.");
    return { png, width: notebook.pageWidth, height: page.height };
  });
  const bytes = await assemblePdf(pages, { title });
  const file = new File(Paths.cache, pdfFileName(title));
  if (file.exists) file.delete();
  file.write(bytes);
  await Sharing.shareAsync(file.uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf" });
}
