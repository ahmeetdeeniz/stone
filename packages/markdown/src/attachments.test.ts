import { describe, expect, it } from "vitest";
import {
  AttachmentError,
  MAX_ATTACHMENT_BYTES,
  assertAttachmentSize,
  attachmentFileName,
  attachmentMarkdown,
  attachmentStoragePath,
  extractAttachmentReferences,
  insertAttachment,
  isAttachmentFileName,
  parseAttachmentLinkTarget,
  referencedAttachmentFiles,
  resolveAttachmentType,
} from "./attachments.js";

const hash = "a".repeat(64);
const png = `${hash}.png`;
const pdf = `${"b".repeat(64)}.pdf`;

describe("note attachments", () => {
  it("resolves images and PDFs from the MIME type or the extension", () => {
    expect(resolveAttachmentType("photo.JPEG").mimeType).toBe("image/jpeg");
    expect(resolveAttachmentType("scan", "application/pdf").extension).toBe("pdf");
    expect(resolveAttachmentType("IMG_1.HEIC", "application/octet-stream").kind).toBe("image");
    expect(() => resolveAttachmentType("notes.docx")).toThrow(AttachmentError);
    expect(() => resolveAttachmentType("x", "text/html")).toThrow(/images and PDF/u);
  });

  it("rejects empty and oversized files", () => {
    expect(() => assertAttachmentSize(0)).toThrow(AttachmentError);
    expect(() => assertAttachmentSize(MAX_ATTACHMENT_BYTES + 1)).toThrow(/20 MB/u);
    expect(() => assertAttachmentSize(MAX_ATTACHMENT_BYTES)).not.toThrow();
  });

  it("names files by content hash and maps them to owner-scoped storage paths", () => {
    const type = resolveAttachmentType("a.png");
    expect(attachmentFileName(hash.toUpperCase(), type)).toBe(png);
    expect(() => attachmentFileName("abc", type)).toThrow();
    expect(isAttachmentFileName(png)).toBe(true);
    expect(isAttachmentFileName("../etc/passwd.png")).toBe(false);
    expect(attachmentStoragePath("uid-1", png)).toBe(`users/uid-1/attachments/${png}`);
    expect(() => attachmentStoragePath("uid/2", png)).toThrow();
    expect(() => attachmentStoragePath("uid", "x.png")).toThrow();
  });

  it("writes portable Markdown: image embeds and PDF links", () => {
    expect(attachmentMarkdown("Tahta [1]", png)).toBe(`![Tahta \\[1\\]](attachments/${png})`);
    expect(attachmentMarkdown("  Fatura\n.pdf ", pdf)).toBe(`[Fatura .pdf](attachments/${pdf})`);
    expect(parseAttachmentLinkTarget(`attachments/${png}`)).toBe(png);
    expect(parseAttachmentLinkTarget("https://example.com/a.png")).toBeNull();
    expect(parseAttachmentLinkTarget("attachments/../x.png")).toBeNull();
  });

  it("inserts an attachment as its own paragraph at the selection", () => {
    const inserted = insertAttachment("Önce\nSonra\n", { from: 5, to: 5 }, "Foto", png);
    expect(inserted.source).toBe(`Önce\n\n![Foto](attachments/${png})\n\nSonra\n`);
    expect(inserted.source.slice(0, inserted.caret).endsWith("\n\n")).toBe(true);
    expect(insertAttachment("", { from: 0, to: 0 }, "Foto", png).source).toBe(
      `![Foto](attachments/${png})\n\n`,
    );
    expect(insertAttachment("Metin", { from: 0, to: 5 }, "Foto", png).source).toBe(
      `![Foto](attachments/${png})\n\n`,
    );
  });

  it("extracts references outside code and de-duplicates file names", () => {
    const markdown = [
      `![Foto \\[1\\]](attachments/${png})`,
      `[Fatura](attachments/${pdf})`,
      "`[kod](attachments/" + png + ")`",
      "```",
      `![içeride](attachments/${pdf})`,
      "```",
      `![tekrar](attachments/${png})`,
      "![dış](https://example.com/x.png)",
    ].join("\n");
    const references = extractAttachmentReferences(markdown);
    expect(references.map((reference) => [reference.label, reference.kind])).toEqual([
      ["Foto [1]", "image"],
      ["Fatura", "pdf"],
      ["tekrar", "image"],
    ]);
    expect(referencedAttachmentFiles(markdown)).toEqual([png, pdf]);
  });
});
