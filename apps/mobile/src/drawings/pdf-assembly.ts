import { PDFDocument } from "pdf-lib";

/** CSS pixels (96 dpi) to PDF points (72 dpi). */
export const POINTS_PER_PIXEL = 0.75;

export interface RenderedPage {
  /** PNG of the whole page, at any resolution. */
  png: Uint8Array;
  /** Page size in notebook units (CSS pixels). */
  width: number;
  height: number;
  /**
   * For a page drawn over a PDF page: that page (1-based) of the PDF attachment `file`, and a
   * transparent PNG of just the notes to lay over it. Used when `sources` has the PDF.
   */
  original?: { file: string; page: number; overlay: Uint8Array };
}

/**
 * One PDF page per notebook page at the page's real size (an A4 page comes out as A4). A page
 * annotated over an imported PDF reuses the original PDF page, so its text stays sharp and
 * selectable, with the notes laid over it; otherwise (or when the original is missing or
 * rotated) the page is a full-page image. Kept free of Skia so it runs anywhere pdf-lib does.
 */
export async function assemblePdf(
  pages: readonly RenderedPage[],
  meta: { title: string; now?: Date },
  sources: ReadonlyMap<string, Uint8Array> = new Map(),
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(meta.title);
  pdf.setCreator("Stone");
  pdf.setProducer("Stone");
  const now = meta.now ?? new Date();
  pdf.setCreationDate(now);
  pdf.setModificationDate(now);
  const loaded = new Map<string, PDFDocument | null>();
  const source = async (file: string) => {
    if (!loaded.has(file)) {
      const bytes = sources.get(file);
      loaded.set(
        file,
        bytes ? await PDFDocument.load(bytes, { ignoreEncryption: true }).catch(() => null) : null,
      );
    }
    return loaded.get(file) ?? null;
  };
  for (const page of pages) {
    const original = page.original ? await source(page.original.file) : null;
    const index = (page.original?.page ?? 0) - 1;
    if (page.original && original && index >= 0 && index < original.getPageCount()) {
      const [copied] = await pdf.copyPages(original, [index]);
      if (copied && copied.getRotation().angle % 360 === 0) {
        pdf.addPage(copied);
        const crop = copied.getCropBox();
        const overlay = await pdf.embedPng(page.original.overlay);
        copied.drawImage(overlay, {
          x: crop.x,
          y: crop.y,
          width: crop.width,
          height: crop.height,
        });
        continue;
      }
    }
    const image = await pdf.embedPng(page.png);
    const width = page.width * POINTS_PER_PIXEL;
    const height = page.height * POINTS_PER_PIXEL;
    pdf.addPage([width, height]).drawImage(image, { x: 0, y: 0, width, height });
  }
  return pdf.save();
}

/** Render scale for a page: sharp (2×) but at most `maxPixels` tall, so endless pages fit memory. */
export function exportScale(height: number, maxPixels = 8000): number {
  return Math.max(0.5, Math.min(2, maxPixels / height));
}

/** A file name for the shared PDF: the title without characters file systems reject. */
export function pdfFileName(title: string): string {
  const clean = [...title]
    .map((character) => (character.charCodeAt(0) < 32 ? " " : character))
    .join("")
    .replace(/[\\/:*?"<>|]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 80);
  return `${clean || "Notebook"}.pdf`;
}
