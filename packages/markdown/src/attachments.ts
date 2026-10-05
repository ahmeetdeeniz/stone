/**
 * Note attachments (images and PDFs) are immutable files named after the SHA-256 of their bytes
 * and referenced from Markdown with ordinary relative links, so a note stays portable:
 *
 *   ![Whiteboard](attachments/<sha256>.png)
 *   [Invoice.pdf](attachments/<sha256>.pdf)
 *
 * Because the name is the content hash, the same file is stored once, uploads are idempotent and
 * two devices can never disagree about what a name points at.
 */
export const ATTACHMENT_DIRECTORY = "attachments" as const;
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

export type AttachmentKind = "image" | "pdf";

export interface AttachmentType {
  extension: AttachmentExtension;
  mimeType: string;
  kind: AttachmentKind;
}

export type AttachmentExtension = "png" | "jpg" | "gif" | "webp" | "heic" | "pdf";

const types: Readonly<Record<AttachmentExtension, AttachmentType>> = {
  png: { extension: "png", mimeType: "image/png", kind: "image" },
  jpg: { extension: "jpg", mimeType: "image/jpeg", kind: "image" },
  gif: { extension: "gif", mimeType: "image/gif", kind: "image" },
  webp: { extension: "webp", mimeType: "image/webp", kind: "image" },
  heic: { extension: "heic", mimeType: "image/heic", kind: "image" },
  pdf: { extension: "pdf", mimeType: "application/pdf", kind: "pdf" },
};

const extensionAliases: Readonly<Record<string, AttachmentExtension>> = {
  png: "png",
  jpg: "jpg",
  jpeg: "jpg",
  gif: "gif",
  webp: "webp",
  heic: "heic",
  heif: "heic",
  pdf: "pdf",
};

const mimeAliases: Readonly<Record<string, AttachmentExtension>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heic",
  "application/pdf": "pdf",
};

/** MIME types a file picker should offer. */
export const ATTACHMENT_MIME_TYPES: readonly string[] = Object.values(types).map(
  (type) => type.mimeType,
);

const fileNamePattern = /^[a-f0-9]{64}\.(?:png|jpg|gif|webp|heic|pdf)$/u;
const referencePattern =
  /(!?)\[((?:\\.|[^\]\\\n])*)\]\(attachments\/([a-f0-9]{64}\.(?:png|jpg|gif|webp|heic|pdf))\)/gu;

export class AttachmentError extends Error {
  public override readonly name = "AttachmentError";

  public constructor(
    public readonly code: "unsupported-type" | "too-large" | "empty",
    message: string,
  ) {
    super(message);
  }
}

/**
 * Resolves the attachment type from a picked file's MIME type, falling back to its extension
 * (pickers often report `application/octet-stream`). Throws for anything that is not an image
 * or a PDF.
 */
export function resolveAttachmentType(name: string, mimeType?: string | null): AttachmentType {
  const fromMime = mimeType ? mimeAliases[mimeType.toLowerCase().split(";")[0]!.trim()] : undefined;
  const dot = name.lastIndexOf(".");
  const fromExtension =
    dot === -1 ? undefined : extensionAliases[name.slice(dot + 1).toLowerCase()];
  const extension = fromMime ?? fromExtension;
  if (!extension) {
    throw new AttachmentError("unsupported-type", "Only images and PDF files can be attached.");
  }
  return types[extension];
}

export function assertAttachmentSize(size: number): void {
  if (size <= 0) throw new AttachmentError("empty", "The selected file is empty.");
  if (size > MAX_ATTACHMENT_BYTES) {
    throw new AttachmentError("too-large", "Attachments can be at most 20 MB.");
  }
}

export function attachmentFileName(sha256: string, type: AttachmentType): string {
  const hash = sha256.toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(hash)) throw new Error("Attachment hash must be SHA-256 hex.");
  return `${hash}.${type.extension}`;
}

export function isAttachmentFileName(value: string): boolean {
  return fileNamePattern.test(value);
}

export function attachmentTypeOf(fileName: string): AttachmentType | null {
  if (!isAttachmentFileName(fileName)) return null;
  return types[fileName.slice(fileName.lastIndexOf(".") + 1) as AttachmentExtension];
}

/** Owner-scoped Firebase Storage object path; mirrors `storage.rules`. */
export function attachmentStoragePath(ownerId: string, fileName: string): string {
  if (!ownerId || ownerId.includes("/")) throw new Error("Attachment owner id is invalid.");
  if (!isAttachmentFileName(fileName)) throw new Error("Attachment file name is invalid.");
  return `users/${ownerId}/${ATTACHMENT_DIRECTORY}/${fileName}`;
}

/** The relative link target used inside notes. */
export function attachmentLinkTarget(fileName: string): string {
  return `${ATTACHMENT_DIRECTORY}/${fileName}`;
}

/** `attachments/<file>` link target → file name, or null for any other URL. */
export function parseAttachmentLinkTarget(url: string): string | null {
  const prefix = `${ATTACHMENT_DIRECTORY}/`;
  if (!url.startsWith(prefix)) return null;
  const fileName = url.slice(prefix.length);
  return isAttachmentFileName(fileName) ? fileName : null;
}

/** Markdown for one attachment, on its own line: an image embed or a link for PDFs. */
export function attachmentMarkdown(label: string, fileName: string): string {
  const type = attachmentTypeOf(fileName);
  if (!type) throw new Error("Attachment file name is invalid.");
  const text = escapeLabel(label.replace(/\s+/gu, " ").trim() || fileName);
  return `${type.kind === "image" ? "!" : ""}[${text}](${attachmentLinkTarget(fileName)})`;
}

/**
 * Inserts an attachment at the selection as its own paragraph and returns the new source and the
 * caret position right after it.
 */
export function insertAttachment(
  source: string,
  selection: { from: number; to: number },
  label: string,
  fileName: string,
): { source: string; caret: number } {
  const from = clamp(Math.min(selection.from, selection.to), 0, source.length);
  const to = clamp(Math.max(selection.from, selection.to), 0, source.length);
  const before = source.slice(0, from);
  const after = source.slice(to);
  const leading =
    before.length === 0 || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
  const trailing = after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n";
  const insertion = `${leading}${attachmentMarkdown(label, fileName)}${trailing}`;
  return { source: `${before}${insertion}${after}`, caret: before.length + insertion.length };
}

export interface AttachmentReference {
  fileName: string;
  label: string;
  kind: AttachmentKind;
  from: number;
  to: number;
}

/** Every attachment link outside fenced and inline code, in document order. */
export function extractAttachmentReferences(markdown: string): readonly AttachmentReference[] {
  const code = codeRanges(markdown);
  const references: AttachmentReference[] = [];
  for (const match of markdown.matchAll(referencePattern)) {
    const from = match.index ?? 0;
    if (code.some((range) => from >= range.from && from < range.to)) continue;
    const fileName = match[3]!;
    const type = attachmentTypeOf(fileName);
    if (!type) continue;
    references.push({
      fileName,
      label: unescapeLabel(match[2] ?? "") || fileName,
      kind: type.kind,
      from,
      to: from + match[0].length,
    });
  }
  return references;
}

/** Distinct attachment file names referenced by a note. */
export function referencedAttachmentFiles(markdown: string): readonly string[] {
  return [...new Set(extractAttachmentReferences(markdown).map((reference) => reference.fileName))];
}

function codeRanges(markdown: string): Array<{ from: number; to: number }> {
  const ranges: Array<{ from: number; to: number }> = [];
  for (const match of markdown.matchAll(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[ \t]*$/gmu)) {
    ranges.push({ from: match.index ?? 0, to: (match.index ?? 0) + match[0].length });
  }
  for (const match of markdown.matchAll(/`[^`\n]*`/gu)) {
    ranges.push({ from: match.index ?? 0, to: (match.index ?? 0) + match[0].length });
  }
  return ranges;
}

function escapeLabel(value: string): string {
  return value.replace(/[[\]\\]/gu, "\\$&");
}

function unescapeLabel(value: string): string {
  return value.replace(/\\([[\]\\])/gu, "$1");
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
