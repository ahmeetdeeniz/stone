export const STONE_DRAWING_MARKER = "stone-drawing" as const;

export interface StoneDrawingBlock {
  id: string;
  title: string;
  schema: 1;
  source: string;
  preview: string;
}

export interface ParsedStoneDrawingBlock extends StoneDrawingBlock {
  markerFrom: number;
  markerTo: number;
  previewFrom: number;
  previewTo: number;
  sourceAvailable: boolean;
}

export interface DrawingSourceState {
  editable: boolean;
  preview: string;
  source?: string;
}

const drawingComment = /<!--\s*stone-drawing:\s*(\{[\s\S]*?\})\s*-->/gu;
const previewImage = /!\[([^\]]*)\]\(([^)\n]+)\)/gu;

export function serializeStoneDrawingMetadata(block: StoneDrawingBlock): string {
  return `<!-- ${STONE_DRAWING_MARKER}: ${JSON.stringify({
    schema: block.schema,
    source: block.source,
    id: block.id,
  })} -->`;
}

export function createDrawingMarkdownBlock(block: StoneDrawingBlock): string {
  return `![${escapeMarkdownLabel(block.title)}](${block.preview})\n${serializeStoneDrawingMetadata(block)}\n`;
}

export function insertDrawingBlock(source: string, block: StoneDrawingBlock, at?: number): string {
  const normalized = normalizeMarkdown(source);
  const insertion = createDrawingMarkdownBlock(block);
  if (at === undefined) return `${normalized}\n${insertion}`;
  const offset = Math.max(0, Math.min(at, normalized.length));
  return `${normalized.slice(0, offset)}${insertion}${normalized.slice(offset)}`;
}

export function extractDrawingBlocks(
  source: string,
  sourceAvailability: ReadonlySet<string> = new Set(),
): readonly ParsedStoneDrawingBlock[] {
  const blocks: ParsedStoneDrawingBlock[] = [];
  for (const match of source.matchAll(drawingComment)) {
    const json = match[1];
    if (!json) continue;
    const metadata = parseDrawingMetadata(json);
    if (!metadata) continue;
    const markerFrom = match.index ?? 0;
    const markerTo = markerFrom + match[0].length;
    const before = source.slice(Math.max(0, markerFrom - 300), markerFrom);
    const image = [...before.matchAll(previewImage)].at(-1);
    if (
      !image ||
      image.index === undefined ||
      !isImmediatelyBeforeImage(before, image.index + image[0].length)
    )
      continue;
    const preview = image[2];
    if (!preview) continue;
    blocks.push({
      ...metadata,
      title: image[1] ?? metadata.id,
      preview,
      markerFrom,
      markerTo,
      previewFrom: markerFrom - before.length + image.index,
      previewTo: markerFrom - before.length + image.index + image[0].length,
      sourceAvailable:
        sourceAvailability.has(metadata.source) || sourceAvailability.has(metadata.id),
    });
  }
  return blocks;
}

export function resolveDrawingSource(
  block: StoneDrawingBlock,
  source: string | undefined,
): DrawingSourceState {
  return source === undefined
    ? { editable: false, preview: block.preview }
    : { editable: true, preview: block.preview, source };
}

export function parseStoneDrawingMetadata(
  source: string,
): Omit<StoneDrawingBlock, "title" | "preview"> | null {
  const metadata = parseDrawingMetadata(source);
  return metadata;
}

function parseDrawingMetadata(source: string): Omit<StoneDrawingBlock, "title" | "preview"> | null {
  try {
    const value = JSON.parse(source) as unknown;
    if (
      !isRecord(value) ||
      value.schema !== 1 ||
      typeof value.id !== "string" ||
      typeof value.source !== "string"
    )
      return null;
    return { schema: 1, id: value.id, source: value.source };
  } catch {
    return null;
  }
}

function normalizeMarkdown(source: string): string {
  const normalized = source.replace(/\r\n?/gu, "\n");
  return normalized.endsWith("\n") ? normalized : `${normalized}\n`;
}

function isImmediatelyBeforeImage(source: string, imageEnd: number): boolean {
  return /^\s*$/u.test(source.slice(imageEnd));
}

function escapeMarkdownLabel(value: string): string {
  return value.replace(/[[\]\\]/gu, "\\$&");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
