import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import type { InkNotebook } from "@stone/ink";
import { renderPagePng, type PageAssets } from "./page-picture";
import { assemblePdf, exportScale, pdfFileName, type RenderedPage } from "./pdf-assembly";

/**
 * Renders every page (paper or PDF page, photos, text and ink) and opens the share sheet with
 * the PDF. Pages over an imported PDF reuse the original file's page when `resolve` can get it.
 */
export async function shareNotebookPdf(
  notebook: InkNotebook,
  title: string,
  assets: PageAssets,
  resolve: (fileName: string) => Promise<string>,
): Promise<void> {
  const sources = new Map<string, Uint8Array>();
  const pages: RenderedPage[] = [];
  for (const page of notebook.pages) {
    const scale = exportScale(page.height);
    const png = renderPagePng(page, notebook.paper, notebook.pageWidth, assets, scale);
    if (!png) throw new Error("A page could not be rendered.");
    const rendered: RenderedPage = { png, width: notebook.pageWidth, height: page.height };
    const background = page.background;
    if (background) {
      if (!sources.has(background.file)) {
        const bytes = await resolve(background.file)
          .then((uri) => new File(uri).bytes())
          .catch(() => null);
        if (bytes) sources.set(background.file, bytes);
      }
      const overlay = renderPagePng(page, notebook.paper, notebook.pageWidth, assets, scale, "ink");
      if (overlay) rendered.original = { file: background.file, page: background.page, overlay };
    }
    pages.push(rendered);
  }
  const bytes = await assemblePdf(pages, { title }, sources);
  const file = new File(Paths.cache, pdfFileName(title));
  if (file.exists) file.delete();
  file.write(bytes);
  await Sharing.shareAsync(file.uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf" });
}
