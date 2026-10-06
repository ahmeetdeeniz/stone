import {
  INK_POINT_STRIDE,
  INK_SCHEMA_VERSION,
  InkValidationError,
  validateInk,
  type InkDocument,
  type InkShape,
  type InkStroke,
} from "./index.js";
import {
  objectBounds,
  validateImages,
  validateTexts,
  type InkImage,
  type InkText,
} from "./page-objects.js";

/**
 * A notebook is an ordered list of pages that share a size and a paper style. Each page holds
 * the same vector layers as a single-canvas {@link InkDocument}, so every drawing tool works on
 * a page through {@link pageDocument} / {@link replacePage}. Schema 1 drawings open as a
 * one-page notebook, so existing `.stoneink` files keep working.
 */
export const INK_NOTEBOOK_SCHEMA_VERSION = 2 as const;
/**
 * Written instead of 2 only when a page holds images or text boxes, so older builds refuse such
 * a notebook ("unsupported schema") instead of opening it and dropping those objects on save.
 */
export const INK_NOTEBOOK_RICH_SCHEMA_VERSION = 3 as const;
export type InkNotebookSchema =
  typeof INK_NOTEBOOK_SCHEMA_VERSION | typeof INK_NOTEBOOK_RICH_SCHEMA_VERSION;

export type InkPaper = "blank" | "lined" | "grid" | "dotted" | "cornell";
export type InkLayout = "pages" | "infinite";

export const INK_PAPERS: readonly InkPaper[] = ["blank", "lined", "grid", "dotted", "cornell"];

/** A4 portrait in CSS pixels (96 dpi): what a page measures before zooming. */
export const A4_PAGE = { width: 794, height: 1123 } as const;
/** Gap drawn between stacked pages, in page units. */
export const PAGE_GAP = 24;

const MAX_PAGES = 500;
const MAX_OBJECTS = 60_000;
const MAX_PAGE_HEIGHT = 20_000;

export interface InkPage {
  id: string;
  /** Equal to the notebook page height for paged notebooks; grows for infinite ones. */
  height: number;
  strokes: readonly InkStroke[];
  shapes: readonly InkShape[];
  /** Photos placed on the page (schema 3). */
  images?: readonly InkImage[];
  /** Typed text boxes (schema 3). */
  texts?: readonly InkText[];
}

export interface InkNotebook {
  schema: InkNotebookSchema;
  id: string;
  title: string;
  layout: InkLayout;
  paper: InkPaper;
  background: string;
  pageWidth: number;
  pageHeight: number;
  pages: readonly InkPage[];
  updatedAt: string;
}

export function createNotebook(input: {
  id: string;
  title: string;
  pageId: string;
  layout?: InkLayout;
  paper?: InkPaper;
  background?: string;
  now?: string;
}): InkNotebook {
  return validateNotebook({
    schema: INK_NOTEBOOK_SCHEMA_VERSION,
    id: input.id,
    title: input.title,
    layout: input.layout ?? "pages",
    paper: input.paper ?? "lined",
    background: input.background ?? "#FFFFFF",
    pageWidth: A4_PAGE.width,
    pageHeight: A4_PAGE.height,
    pages: [{ id: input.pageId, height: A4_PAGE.height, strokes: [], shapes: [] }],
    updatedAt: input.now ?? new Date().toISOString(),
  });
}

/** Parses a `.stoneink` file of either schema; a schema 1 drawing becomes one blank page. */
export function parseNotebook(source: string): InkNotebook {
  let value: unknown;
  try {
    value = JSON.parse(source) as unknown;
  } catch {
    throw new InkValidationError("Invalid Stone Ink JSON.");
  }
  if (isRecord(value) && value.schema === INK_SCHEMA_VERSION)
    return notebookFromInk(validateInk(value));
  return validateNotebook(value);
}

/** Compact JSON: coordinates to 0.1 px and pressure to 0.01, which is below what a pen resolves. */
export function serializeNotebook(notebook: InkNotebook): string {
  const valid = validateNotebook(notebook);
  return `${JSON.stringify({
    ...valid,
    pages: valid.pages.map((page) => {
      const { images, texts, ...rest } = page;
      return {
        ...rest,
        strokes: page.strokes.map((stroke) => ({ ...stroke, points: quantize(stroke.points) })),
        ...(images?.length ? { images } : {}),
        ...(texts?.length ? { texts } : {}),
      };
    }),
  })}\n`;
}

export function notebookFromInk(document: InkDocument): InkNotebook {
  return {
    schema: INK_NOTEBOOK_SCHEMA_VERSION,
    id: document.id,
    title: document.title,
    layout: "pages",
    paper: "blank",
    background: document.background,
    pageWidth: document.width,
    pageHeight: document.height,
    pages: [
      {
        id: `${document.id}:1`,
        height: document.height,
        strokes: document.strokes,
        shapes: document.shapes,
      },
    ],
    updatedAt: document.updatedAt,
  };
}

export function validateNotebook(value: unknown): InkNotebook {
  if (
    !isRecord(value) ||
    (value.schema !== INK_NOTEBOOK_SCHEMA_VERSION &&
      value.schema !== INK_NOTEBOOK_RICH_SCHEMA_VERSION)
  )
    throw new InkValidationError("Unsupported Stone Ink schema version.");
  if (value.layout !== "pages" && value.layout !== "infinite")
    throw new InkValidationError("Notebook layout is invalid.");
  if (!INK_PAPERS.includes(value.paper as InkPaper))
    throw new InkValidationError("Notebook paper is invalid.");
  if (!Array.isArray(value.pages) || value.pages.length === 0 || value.pages.length > MAX_PAGES)
    throw new InkValidationError("Notebook pages are invalid.");
  const base = {
    id: value.id,
    title: value.title,
    background: value.background,
    width: value.pageWidth,
    updatedAt: value.updatedAt,
  };
  // Each page is checked with the single-canvas validator so the rules stay in one place.
  const pages = value.pages.map((page: unknown): InkPage => {
    if (
      !isRecord(page) ||
      typeof page.id !== "string" ||
      page.id.trim() === "" ||
      page.id.length > 160
    )
      throw new InkValidationError("Notebook page is invalid.");
    const height = page.height;
    if (
      typeof height !== "number" ||
      !Number.isFinite(height) ||
      height <= 0 ||
      height > MAX_PAGE_HEIGHT
    )
      throw new InkValidationError("Notebook page height is invalid.");
    const checked = validateInk({
      ...base,
      schema: INK_SCHEMA_VERSION,
      height,
      strokes: page.strokes,
      shapes: page.shapes,
    });
    const images = validateImages(page.images);
    const texts = validateTexts(page.texts);
    return {
      id: page.id,
      height,
      strokes: checked.strokes,
      shapes: checked.shapes,
      ...(images.length ? { images } : {}),
      ...(texts.length ? { texts } : {}),
    };
  });
  const first = validateInk({
    ...base,
    schema: INK_SCHEMA_VERSION,
    height: value.pageHeight,
    strokes: [],
    shapes: [],
  });
  if (
    pages.reduce(
      (total, page) =>
        total +
        page.strokes.length +
        page.shapes.length +
        (page.images?.length ?? 0) +
        (page.texts?.length ?? 0),
      0,
    ) > MAX_OBJECTS
  )
    throw new InkValidationError("Notebook contains too many objects.");
  if (new Set(pages.map((page) => page.id)).size !== pages.length)
    throw new InkValidationError("Notebook page ids must be unique.");
  const rich = pages.some((page) => page.images?.length || page.texts?.length);
  return {
    schema: rich ? INK_NOTEBOOK_RICH_SCHEMA_VERSION : INK_NOTEBOOK_SCHEMA_VERSION,
    id: first.id,
    title: first.title,
    layout: value.layout,
    paper: value.paper as InkPaper,
    background: first.background,
    pageWidth: first.width,
    pageHeight: first.height,
    pages,
    updatedAt: first.updatedAt,
  };
}

/** One page as a single-canvas document, so the existing editing functions apply to it. */
export function pageDocument(notebook: InkNotebook, index: number): InkDocument {
  const page = requirePage(notebook, index);
  return {
    schema: INK_SCHEMA_VERSION,
    id: page.id,
    title: notebook.title,
    width: notebook.pageWidth,
    height: page.height,
    background: notebook.background,
    strokes: page.strokes,
    shapes: page.shapes,
    updatedAt: notebook.updatedAt,
  };
}

/** Writes an edited page back. Infinite pages grow when ink comes close to the bottom. */
export function replacePage(
  notebook: InkNotebook,
  index: number,
  document: InkDocument,
): InkNotebook {
  const page = requirePage(notebook, index);
  const height =
    notebook.layout === "infinite" ? grownHeight(notebook, page.height, document) : page.height;
  const pages = notebook.pages.map((item, position) =>
    position === index
      ? { ...item, height, strokes: document.strokes, shapes: document.shapes }
      : item,
  );
  return { ...notebook, pages, updatedAt: document.updatedAt };
}

export function addPage(
  notebook: InkNotebook,
  pageId: string,
  afterIndex = notebook.pages.length - 1,
  now = new Date().toISOString(),
): InkNotebook {
  if (notebook.pages.length >= MAX_PAGES)
    throw new InkValidationError("Notebook has too many pages.");
  if (notebook.pages.some((page) => page.id === pageId))
    throw new InkValidationError("Notebook page ids must be unique.");
  const position = Math.max(-1, Math.min(afterIndex, notebook.pages.length - 1)) + 1;
  const page: InkPage = { id: pageId, height: notebook.pageHeight, strokes: [], shapes: [] };
  const pages = [...notebook.pages.slice(0, position), page, ...notebook.pages.slice(position)];
  return { ...notebook, pages, updatedAt: now };
}

/** Removes a page; the last remaining page is cleared instead so a notebook is never empty. */
export function removePage(
  notebook: InkNotebook,
  index: number,
  now = new Date().toISOString(),
): InkNotebook {
  const page = requirePage(notebook, index);
  if (notebook.pages.length === 1)
    return {
      ...notebook,
      pages: [{ id: page.id, height: notebook.pageHeight, strokes: [], shapes: [] }],
      updatedAt: now,
    };
  return {
    ...notebook,
    pages: notebook.pages.filter((_, position) => position !== index),
    updatedAt: now,
  };
}

export function setPaper(
  notebook: InkNotebook,
  paper: InkPaper,
  now = new Date().toISOString(),
): InkNotebook {
  if (!INK_PAPERS.includes(paper)) throw new InkValidationError("Notebook paper is invalid.");
  return { ...notebook, paper, updatedAt: now };
}

/** Top edge of every page when the pages are stacked vertically with {@link PAGE_GAP}. */
export function pageOffsets(notebook: InkNotebook): readonly number[] {
  const offsets: number[] = [];
  let top = 0;
  for (const page of notebook.pages) {
    offsets.push(top);
    top += page.height + PAGE_GAP;
  }
  return offsets;
}

export function notebookHeight(notebook: InkNotebook): number {
  return (
    notebook.pages.reduce((total, page) => total + page.height, 0) +
    PAGE_GAP * (notebook.pages.length - 1)
  );
}

/** The page under a notebook-space point and the point in that page's coordinates. */
export function locatePoint(
  notebook: InkNotebook,
  x: number,
  y: number,
): { pageIndex: number; x: number; y: number } | null {
  if (x < 0 || x > notebook.pageWidth) return null;
  const offsets = pageOffsets(notebook);
  for (let index = 0; index < notebook.pages.length; index += 1) {
    const top = offsets[index]!;
    if (y >= top && y <= top + notebook.pages[index]!.height)
      return { pageIndex: index, x, y: y - top };
  }
  return null;
}

/** Horizontal rules, grid lines and dots for a paper style, in page coordinates. */
export interface PaperGuides {
  lines: ReadonlyArray<{ x1: number; y1: number; x2: number; y2: number; accent: boolean }>;
  dots: ReadonlyArray<{ x: number; y: number }>;
}

export function paperGuides(paper: InkPaper, width: number, height: number): PaperGuides {
  const lines: Array<{ x1: number; y1: number; x2: number; y2: number; accent: boolean }> = [];
  const dots: Array<{ x: number; y: number }> = [];
  const rule = 32;
  if (paper === "lined" || paper === "cornell") {
    const top = paper === "cornell" ? 96 : 112;
    const bottom = paper === "cornell" ? height * 0.78 : height - 48;
    const left = paper === "cornell" ? width * 0.28 : 0;
    for (let y = top; y <= bottom; y += rule)
      lines.push({ x1: left, y1: y, x2: width, y2: y, accent: false });
    if (paper === "lined") lines.push({ x1: 88, y1: 0, x2: 88, y2: height, accent: true });
    if (paper === "cornell") {
      lines.push({ x1: 0, y1: 72, x2: width, y2: 72, accent: true });
      lines.push({ x1: left, y1: 72, x2: left, y2: height * 0.8, accent: true });
      lines.push({ x1: 0, y1: height * 0.8, x2: width, y2: height * 0.8, accent: true });
    }
  } else if (paper === "grid") {
    const step = 24;
    for (let y = step; y < height; y += step)
      lines.push({ x1: 0, y1: y, x2: width, y2: y, accent: false });
    for (let x = step; x < width; x += step)
      lines.push({ x1: x, y1: 0, x2: x, y2: height, accent: false });
  } else if (paper === "dotted") {
    const step = 24;
    for (let y = step; y < height; y += step)
      for (let x = step; x < width; x += step) dots.push({ x, y });
  }
  return { lines, dots };
}

function grownHeight(notebook: InkNotebook, current: number, document: InkDocument): number {
  let bottom = 0;
  for (const stroke of document.strokes)
    for (let index = 1; index < stroke.points.length; index += INK_POINT_STRIDE)
      bottom = Math.max(bottom, stroke.points[index]!);
  for (const shape of document.shapes) bottom = Math.max(bottom, shape.from.y, shape.to.y);
  return heightFor(notebook, current, bottom);
}

function heightFor(notebook: InkNotebook, current: number, bottom: number): number {
  // Keep at least half a page of empty paper below the lowest ink.
  const needed = bottom + notebook.pageHeight / 2;
  if (needed <= current) return current;
  const step = notebook.pageHeight / 2;
  return Math.min(MAX_PAGE_HEIGHT, current + Math.ceil((needed - current) / step) * step);
}

function requirePage(notebook: InkNotebook, index: number): InkPage {
  const page = notebook.pages[index];
  if (!page) throw new InkValidationError("Notebook page does not exist.");
  return page;
}

function quantize(points: readonly number[]): readonly number[] {
  return points.map((value, index) =>
    index % INK_POINT_STRIDE === 2 ? Math.round(value * 100) / 100 : Math.round(value * 10) / 10,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Replaces a page's photos and text boxes (an infinite page grows to keep them on paper). */
export function setPageObjects(
  notebook: InkNotebook,
  index: number,
  objects: { images?: readonly InkImage[]; texts?: readonly InkText[] },
  now = new Date().toISOString(),
): InkNotebook {
  const page = requirePage(notebook, index);
  const images = objects.images ?? page.images ?? [];
  const texts = objects.texts ?? page.texts ?? [];
  let height = page.height;
  if (notebook.layout === "infinite") {
    const bottom = Math.max(
      0,
      ...[...images, ...texts].map((object) => objectBounds(object).bottom),
    );
    height = Math.max(height, heightFor(notebook, height, bottom));
  }
  const next: InkPage = {
    id: page.id,
    height,
    strokes: page.strokes,
    shapes: page.shapes,
    ...(images.length ? { images } : {}),
    ...(texts.length ? { texts } : {}),
  };
  return {
    ...notebook,
    pages: notebook.pages.map((item, position) => (position === index ? next : item)),
    updatedAt: now,
  };
}

/** Moves a page to another position (indexes are clamped). */
export function movePage(
  notebook: InkNotebook,
  from: number,
  to: number,
  now = new Date().toISOString(),
): InkNotebook {
  const page = requirePage(notebook, from);
  const target = Math.max(0, Math.min(notebook.pages.length - 1, to));
  if (target === from) return notebook;
  const pages = notebook.pages.filter((_, position) => position !== from);
  pages.splice(target, 0, page);
  return { ...notebook, pages, updatedAt: now };
}

/** Inserts a copy of a page right after it; every object in the copy gets a fresh id. */
export function duplicatePage(
  notebook: InkNotebook,
  index: number,
  newId: () => string,
  now = new Date().toISOString(),
): InkNotebook {
  const page = requirePage(notebook, index);
  if (notebook.pages.length >= MAX_PAGES)
    throw new InkValidationError("Notebook has too many pages.");
  const copy: InkPage = {
    ...page,
    id: newId(),
    strokes: page.strokes.map((stroke) => ({ ...stroke, id: newId() })),
    shapes: page.shapes.map((shape) => ({ ...shape, id: newId() })),
    ...(page.images ? { images: page.images.map((image) => ({ ...image, id: newId() })) } : {}),
    ...(page.texts ? { texts: page.texts.map((text) => ({ ...text, id: newId() })) } : {}),
  };
  const pages = [...notebook.pages];
  pages.splice(index + 1, 0, copy);
  return { ...notebook, pages, updatedAt: now };
}

/** Attachment files (`<sha256>.<ext>`) the notebook's pages refer to. */
export function notebookAttachments(notebook: InkNotebook): readonly string[] {
  const files = new Set<string>();
  for (const page of notebook.pages) for (const image of page.images ?? []) files.add(image.file);
  return [...files];
}
