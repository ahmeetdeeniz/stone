import type { PdfPageImport } from "@stone/ink";
import type { PickedAttachment } from "../attachments/attachment-service";
import type { PdfPageSize, RenderedPdfPage } from "./PdfRenderer";

/** Rendered page images are twice the notebook page width: sharp at the usual zoom levels. */
export const PDF_RENDER_SCALE = 2;
/** More pages than this in one import is almost certainly a mistake (a whole book). */
export const MAX_IMPORT_PAGES = 300;

export interface PdfImportDeps {
  renderer: {
    open(base64: string): Promise<readonly PdfPageSize[]>;
    render(number: number, width: number): Promise<RenderedPdfPage>;
    close(): void;
  };
  /** Base64 content of the picked file. */
  readBase64(uri: string): Promise<string>;
  /** Stores a file as an attachment (queued for upload) and returns its file name. */
  addAttachment(picked: PickedAttachment): Promise<string>;
  /** Writes a rendered page to a temporary file the attachment store can import. */
  writeTemp(base64: string, name: string): Promise<{ uri: string; size: number }>;
  newId(): string;
}

export interface PdfImportResult {
  /** The PDF's own attachment file name. */
  file: string;
  /** The file name without its extension, for a new notebook's title. */
  title: string;
  pages: readonly PdfPageImport[];
  /** Pages left out because of the page limit. */
  skipped: number;
}

export class PdfImportCancelled extends Error {
  public override readonly name = "PdfImportCancelled";
}

/**
 * Stores the PDF as an attachment, then renders each page to a WebP attachment that becomes a
 * page background. Pages keep the PDF page's aspect at the notebook's page width.
 */
export async function importPdf(
  picked: PickedAttachment,
  deps: PdfImportDeps,
  options: {
    pageWidth: number;
    maxPages?: number;
    onProgress?: (done: number, total: number) => void;
    isCancelled?: () => boolean;
  },
): Promise<PdfImportResult> {
  const file = await deps.addAttachment(picked);
  const sizes = await deps.renderer.open(await deps.readBase64(picked.uri));
  try {
    const limit = Math.max(0, Math.min(options.maxPages ?? MAX_IMPORT_PAGES, MAX_IMPORT_PAGES));
    const count = Math.min(sizes.length, limit);
    const pages: PdfPageImport[] = [];
    options.onProgress?.(0, count);
    for (let index = 0; index < count; index += 1) {
      if (options.isCancelled?.()) throw new PdfImportCancelled("Import cancelled.");
      const number = index + 1;
      const rendered = await deps.renderer.render(number, options.pageWidth * PDF_RENDER_SCALE);
      const temp = await deps.writeTemp(rendered.data, `pdf-page-${number}.webp`);
      const image = await deps.addAttachment({
        uri: temp.uri,
        name: `page-${number}.webp`,
        mimeType: "image/webp",
        size: temp.size,
      });
      const size = sizes[index]!;
      pages.push({
        id: deps.newId(),
        height: Math.round((options.pageWidth * size.height) / size.width),
        background: { kind: "pdf", file, page: number, image },
      });
      options.onProgress?.(number, count);
    }
    return { file, title: titleOf(picked.name), pages, skipped: sizes.length - count };
  } finally {
    deps.renderer.close();
  }
}

export function titleOf(name: string): string {
  return name.replace(/\.pdf$/iu, "").trim() || name;
}
