import { degrees, PDFDocument, PDFName, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { assemblePdf, exportScale, pdfFileName } from "./pdf-assembly";

// 1×1 white PNG.
const PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
  ),
  (character) => character.charCodeAt(0),
);

describe("notebook PDF export", () => {
  it("makes one page per notebook page at its real size", async () => {
    const bytes = await assemblePdf(
      [
        { png: PNG, width: 794, height: 1123 },
        { png: PNG, width: 794, height: 2246 },
      ],
      { title: "Fizik 101", now: new Date("2026-10-06T10:00:00Z") },
    );
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(2);
    const [a4, tall] = pdf.getPages();
    expect(a4!.getWidth()).toBeCloseTo(595.5);
    expect(a4!.getHeight()).toBeCloseTo(842.25);
    expect(tall!.getHeight()).toBeCloseTo(1684.5);
    expect(pdf.getTitle()).toBe("Fizik 101");
  });

  it("reuses the original PDF page under the notes, and falls back to the image", async () => {
    const original = await PDFDocument.create();
    const font = await original.embedFont(StandardFonts.Helvetica);
    original.addPage([960, 540]).drawText("Slide one", { x: 40, y: 480, size: 32, font });
    original.addPage([960, 540]).setRotation(degrees(90));
    const sources = new Map([["slides.pdf", await original.save()]]);
    const bytes = await assemblePdf(
      [
        {
          png: PNG,
          width: 794,
          height: 447,
          original: { file: "slides.pdf", page: 1, overlay: PNG },
        },
        {
          png: PNG,
          width: 794,
          height: 447,
          original: { file: "slides.pdf", page: 2, overlay: PNG },
        },
        {
          png: PNG,
          width: 794,
          height: 447,
          original: { file: "missing.pdf", page: 1, overlay: PNG },
        },
      ],
      { title: "Slaytlar" },
      sources,
    );
    const pdf = await PDFDocument.load(bytes);
    const [kept, rotated, missing] = pdf.getPages();
    // The original page keeps its own size (960×540 pt) and its text.
    expect(kept!.getWidth()).toBe(960);
    expect(kept!.node.Resources()?.get(PDFName.of("Font"))).toBeDefined();
    // A rotated original or a missing file falls back to the full-page image at notebook size.
    expect(rotated!.getWidth()).toBeCloseTo(595.5);
    expect(missing!.getHeight()).toBeCloseTo(335.25);
  });

  it("keeps endless pages within a sane bitmap height and names the file", () => {
    expect(exportScale(1123)).toBe(2);
    expect(exportScale(20_000)).toBe(0.5);
    expect(pdfFileName('Ders: "Fizik/1"')).toBe("Ders Fizik 1.pdf");
    expect(pdfFileName("  ")).toBe("Notebook.pdf");
  });
});
