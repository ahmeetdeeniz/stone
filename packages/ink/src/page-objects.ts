import { InkValidationError, type InkBounds } from "./index.js";

/**
 * Things placed on a notebook page besides ink: photos and typed text. Images point at a
 * content-addressed attachment (`<sha256>.<ext>`) that syncs like note attachments, so the
 * `.stoneink` file stays small.
 */
export interface InkImage {
  id: string;
  file: string;
  x: number;
  y: number;
  width: number;
  height: number;
  createdAt: string;
}

/** A text box: `width` is where lines wrap; `height` is what the app last measured. */
export interface InkText {
  id: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  size: number;
  color: string;
  createdAt: string;
}

export type InkPageObject = { kind: "image"; object: InkImage } | { kind: "text"; object: InkText };

export const MAX_PAGE_IMAGES = 100;
export const MAX_PAGE_TEXTS = 300;
export const MAX_TEXT_LENGTH = 10_000;
export const TEXT_SIZES = [16, 20, 28] as const;

const ATTACHMENT_FILE = /^[a-f0-9]{64}\.(png|jpe?g|gif|webp|heic|pdf)$/u;
const COLOR = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/u;
const COORDINATE_LIMIT = 100_000;

export function isInkAttachmentFile(value: unknown): value is string {
  return typeof value === "string" && ATTACHMENT_FILE.test(value);
}

export function validateImages(value: unknown): readonly InkImage[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_PAGE_IMAGES)
    throw new InkValidationError("Page images are invalid.");
  const images = value.map((image: unknown): InkImage => {
    if (!isRecord(image) || !validId(image.id) || !isInkAttachmentFile(image.file))
      throw new InkValidationError("Page image is invalid.");
    const box = validBox(image);
    if (!box || typeof image.createdAt !== "string")
      throw new InkValidationError("Page image is invalid.");
    return { id: image.id, file: image.file, ...box, createdAt: image.createdAt };
  });
  assertUniqueIds(images);
  return images;
}

export function validateTexts(value: unknown): readonly InkText[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_PAGE_TEXTS)
    throw new InkValidationError("Page texts are invalid.");
  const texts = value.map((text: unknown): InkText => {
    if (
      !isRecord(text) ||
      !validId(text.id) ||
      typeof text.text !== "string" ||
      text.text.length > MAX_TEXT_LENGTH ||
      typeof text.color !== "string" ||
      !COLOR.test(text.color) ||
      typeof text.size !== "number" ||
      !(text.size >= 6 && text.size <= 200) ||
      typeof text.createdAt !== "string"
    )
      throw new InkValidationError("Page text is invalid.");
    const box = validBox(text);
    if (!box) throw new InkValidationError("Page text is invalid.");
    return {
      id: text.id,
      text: text.text,
      ...box,
      size: text.size,
      color: text.color,
      createdAt: text.createdAt,
    };
  });
  assertUniqueIds(texts);
  return texts;
}

export function objectBounds(object: InkImage | InkText): InkBounds {
  return {
    left: object.x,
    top: object.y,
    right: object.x + object.width,
    bottom: object.y + object.height,
  };
}

/** The top-most object under a page point (texts above images, later above earlier). */
export function objectAt(
  page: { images?: readonly InkImage[]; texts?: readonly InkText[] },
  x: number,
  y: number,
  slop = 0,
): InkPageObject | null {
  const inside = (object: InkImage | InkText) =>
    x >= object.x - slop &&
    x <= object.x + object.width + slop &&
    y >= object.y - slop &&
    y <= object.y + object.height + slop;
  const texts = page.texts ?? [];
  for (let index = texts.length - 1; index >= 0; index -= 1)
    if (inside(texts[index]!)) return { kind: "text", object: texts[index]! };
  const images = page.images ?? [];
  for (let index = images.length - 1; index >= 0; index -= 1)
    if (inside(images[index]!)) return { kind: "image", object: images[index]! };
  return null;
}

/** Fits an image of `natural` size inside `max` (keeping its aspect), centred on `centre`. */
export function placeImage(
  natural: { width: number; height: number },
  max: { width: number; height: number },
  centre: { x: number; y: number },
): { x: number; y: number; width: number; height: number } {
  const scale = Math.min(1, max.width / natural.width, max.height / natural.height);
  const width = Math.max(8, natural.width * scale);
  const height = Math.max(8, natural.height * scale);
  return { x: centre.x - width / 2, y: centre.y - height / 2, width, height };
}

function validBox(
  value: Record<string, unknown>,
): { x: number; y: number; width: number; height: number } | null {
  const { x, y, width, height } = value;
  if (
    typeof x !== "number" ||
    typeof y !== "number" ||
    typeof width !== "number" ||
    typeof height !== "number" ||
    ![x, y, width, height].every(Number.isFinite) ||
    Math.abs(x) > COORDINATE_LIMIT ||
    Math.abs(y) > COORDINATE_LIMIT ||
    width <= 0 ||
    height <= 0 ||
    width > COORDINATE_LIMIT ||
    height > COORDINATE_LIMIT
  )
    return null;
  return { x, y, width, height };
}

function validId(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "" && value.length <= 160;
}

function assertUniqueIds(objects: ReadonlyArray<{ id: string }>): void {
  if (new Set(objects.map((object) => object.id)).size !== objects.length)
    throw new InkValidationError("Page object ids must be unique.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
