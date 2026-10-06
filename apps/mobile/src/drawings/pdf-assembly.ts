import { PDFDocument } from "pdf-lib";

/** CSS pixels (96 dpi) to PDF points (72 dpi). */
export const POINTS_PER_PIXEL = 0.75;

export interface RenderedPage {
  /** PNG of the page, at any resolution. */
  png: Uint8Array;
  /** Page size in notebook units (CSS pixels). */
  width: number;
  height: number;
}

/**
 * One PDF page per notebook page, each a full-page image at the page's real size (an A4 page
 * comes out as A4). Kept free of Skia so it runs anywhere pdf-lib does.
 */
export async function assemblePdf(
  pages: readonly RenderedPage[],
  meta: { title: string; now?: Date },
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(meta.title);
  pdf.setCreator("Stone");
  pdf.setProducer("Stone");
  const now = meta.now ?? new Date();
  pdf.setCreationDate(now);
  pdf.setModificationDate(now);
  for (const page of pages) {
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
