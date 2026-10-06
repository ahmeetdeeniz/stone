import {
  BlendMode,
  ClipOp,
  PaintStyle,
  Skia,
  StrokeCap,
  StrokeJoin,
  type SkCanvas,
  type SkFont,
  type SkImage,
  type SkPath,
  type SkPicture,
  type SkTypeface,
} from "@shopify/react-native-skia";
import {
  flatToPoints,
  paperGuides,
  type InkImage,
  type InkPaper,
  type InkPage,
  type InkShape,
  type InkStroke,
  type InkText,
} from "@stone/ink";
import { strokeOutline } from "./notebook-view";
import { layoutText, lineHeightFor } from "./text-layout";

/** What a page needs besides its own data: decoded photos and the typeface for text boxes. */
export interface PageAssets {
  images: ReadonlyMap<string, SkImage>;
  typeface: SkTypeface | null;
}

export const NO_ASSETS: PageAssets = { images: new Map(), typeface: null };

export interface PaperPalette {
  paper: string;
  guide: string;
  accent: string;
}

/** Ruled-paper colours: quiet greys with the brand accent for margins, like a real notebook. */
export const PAPER_PALETTE: PaperPalette = {
  paper: "#FFFFFF",
  guide: "#D9D6D3",
  accent: "#F1C9BE",
};

/** Smooth filled path through a perfect-freehand outline. */
export function outlinePath(outline: readonly number[][]): SkPath {
  const path = Skia.Path.Make();
  const first = outline[0];
  if (!first) return path;
  path.moveTo(first[0]!, first[1]!);
  for (let index = 1; index < outline.length; index += 1) {
    const current = outline[index]!;
    const next = outline[(index + 1) % outline.length]!;
    path.quadTo(
      current[0]!,
      current[1]!,
      (current[0]! + next[0]!) / 2,
      (current[1]! + next[1]!) / 2,
    );
  }
  path.close();
  return path;
}

export function drawStroke(canvas: SkCanvas, stroke: InkStroke, complete = true): void {
  const highlighter = stroke.tool === "highlighter";
  const outline = strokeOutline(flatToPoints(stroke.points), stroke.width, {
    highlighter,
    realPressure: hasRealPressure(stroke.points),
    complete,
  });
  if (outline.length < 3) return;
  const paint = Skia.Paint();
  paint.setAntiAlias(true);
  paint.setColor(Skia.Color(stroke.color));
  paint.setAlphaf(highlighter ? stroke.opacity * 0.35 : stroke.opacity);
  if (highlighter) paint.setBlendMode(BlendMode.Multiply);
  canvas.drawPath(outlinePath(outline), paint);
}

export function drawShape(canvas: SkCanvas, shape: InkShape): void {
  const paint = Skia.Paint();
  paint.setAntiAlias(true);
  paint.setColor(Skia.Color(shape.color));
  paint.setAlphaf(shape.opacity);
  paint.setStyle(shape.filled ? PaintStyle.Fill : PaintStyle.Stroke);
  paint.setStrokeWidth(shape.width);
  paint.setStrokeCap(StrokeCap.Round);
  paint.setStrokeJoin(StrokeJoin.Round);
  const { from, to } = shape;
  const rect = Skia.XYWHRect(
    Math.min(from.x, to.x),
    Math.min(from.y, to.y),
    Math.abs(to.x - from.x),
    Math.abs(to.y - from.y),
  );
  if (shape.kind === "rectangle") canvas.drawRect(rect, paint);
  else if (shape.kind === "ellipse") canvas.drawOval(rect, paint);
  else {
    canvas.drawLine(from.x, from.y, to.x, to.y, paint);
    if (shape.kind === "arrow") {
      const angle = Math.atan2(to.y - from.y, to.x - from.x);
      const size = Math.max(shape.width * 4, 10);
      for (const side of [-1, 1]) {
        canvas.drawLine(
          to.x,
          to.y,
          to.x - size * Math.cos(angle + (side * Math.PI) / 6),
          to.y - size * Math.sin(angle + (side * Math.PI) / 6),
          paint,
        );
      }
    }
  }
}

export function drawPaper(
  canvas: SkCanvas,
  paper: InkPaper,
  width: number,
  height: number,
  palette: PaperPalette = PAPER_PALETTE,
): void {
  const background = Skia.Paint();
  background.setColor(Skia.Color(palette.paper));
  canvas.drawRect(Skia.XYWHRect(0, 0, width, height), background);
  const guides = paperGuides(paper, width, height);
  const line = Skia.Paint();
  line.setAntiAlias(true);
  line.setStyle(PaintStyle.Stroke);
  line.setStrokeWidth(1);
  const accent = line.copy();
  line.setColor(Skia.Color(palette.guide));
  accent.setColor(Skia.Color(palette.accent));
  accent.setStrokeWidth(1.5);
  for (const guide of guides.lines)
    canvas.drawLine(guide.x1, guide.y1, guide.x2, guide.y2, guide.accent ? accent : line);
  const dot = Skia.Paint();
  dot.setAntiAlias(true);
  dot.setColor(Skia.Color(palette.guide));
  for (const point of guides.dots) canvas.drawCircle(point.x, point.y, 1.4, dot);
}

/** A photo scaled into its box; a placeholder frame while it is still loading or downloading. */
export function drawImage(canvas: SkCanvas, image: InkImage, decoded: SkImage | undefined): void {
  const rect = Skia.XYWHRect(image.x, image.y, image.width, image.height);
  if (decoded) {
    const paint = Skia.Paint();
    paint.setAntiAlias(true);
    canvas.drawImageRect(
      decoded,
      Skia.XYWHRect(0, 0, decoded.width(), decoded.height()),
      rect,
      paint,
    );
    return;
  }
  const fill = Skia.Paint();
  fill.setColor(Skia.Color("#F5F5F4"));
  canvas.drawRect(rect, fill);
  const frame = Skia.Paint();
  frame.setStyle(PaintStyle.Stroke);
  frame.setStrokeWidth(1);
  frame.setColor(Skia.Color("#D6D3D1"));
  canvas.drawRect(rect, frame);
}

export function drawText(canvas: SkCanvas, text: InkText, typeface: SkTypeface | null): void {
  if (!typeface || !text.text) return;
  const font = Skia.Font(typeface, text.size);
  const paint = Skia.Paint();
  paint.setAntiAlias(true);
  paint.setColor(Skia.Color(text.color));
  const lineHeight = lineHeightFor(text.size);
  const lines = layoutText(text.text, text.width, (value) => textWidth(font, value));
  lines.forEach((line, index) => {
    // Baseline at roughly 80 % of the line box, so the first line starts at the box top.
    canvas.drawText(line, text.x, text.y + lineHeight * index + text.size * 1.05, paint, font);
  });
}

/** Advance width of a string (summed glyph widths: works on native and on CanvasKit web). */
function textWidth(font: SkFont, value: string): number {
  let width = 0;
  for (const glyph of font.getGlyphWidths(font.getGlyphIDs(value))) width += glyph;
  return width;
}

/** Height a text box needs for its content at its width (for hit-testing and selection). */
export function measureTextHeight(text: InkText, typeface: SkTypeface | null): number {
  if (!typeface) return Math.max(text.height, lineHeightFor(text.size));
  const font = Skia.Font(typeface, text.size);
  const lines = layoutText(text.text, text.width, (value) => textWidth(font, value));
  return Math.max(1, lines.length) * lineHeightFor(text.size);
}

/** A PDF page's pre-rendered image filling the page; a blank sheet until it has loaded. */
function drawBackground(canvas: SkCanvas, page: InkPage, width: number, assets: PageAssets): void {
  const white = Skia.Paint();
  white.setColor(Skia.Color("#FFFFFF"));
  const rect = Skia.XYWHRect(0, 0, width, page.height);
  canvas.drawRect(rect, white);
  const image = page.background ? assets.images.get(page.background.image) : undefined;
  if (!image) return;
  const paint = Skia.Paint();
  paint.setAntiAlias(true);
  canvas.drawImageRect(image, Skia.XYWHRect(0, 0, image.width(), image.height()), rect, paint);
}

/**
 * Records a whole page once (paper or PDF page, photos, text, shapes, then strokes on top, so
 * ink can annotate a photo or a slide); it is redrawn from the picture. `layers: "ink"` leaves
 * the paper and PDF page out (transparent), for laying the notes over an original PDF page.
 */
export function recordPage(
  page: InkPage,
  paper: InkPaper,
  width: number,
  assets: PageAssets = NO_ASSETS,
  palette: PaperPalette = PAPER_PALETTE,
  layers: "page" | "ink" = "page",
): SkPicture {
  const recorder = Skia.PictureRecorder();
  const bounds = Skia.XYWHRect(0, 0, width, page.height);
  const canvas = recorder.beginRecording(bounds);
  // Nothing (a photo dragged to the edge, a long stroke) draws past the paper onto the desk.
  canvas.clipRect(bounds, ClipOp.Intersect, true);
  if (layers === "page") {
    if (page.background) drawBackground(canvas, page, width, assets);
    else drawPaper(canvas, paper, width, page.height, palette);
  }
  for (const image of page.images ?? []) drawImage(canvas, image, assets.images.get(image.file));
  for (const text of page.texts ?? []) drawText(canvas, text, assets.typeface);
  for (const shape of page.shapes) drawShape(canvas, shape);
  for (const stroke of page.strokes) drawStroke(canvas, stroke);
  return recorder.finishRecordingAsPicture();
}

/** PNG of one page: the drawing preview embedded in notes, and pages of a PDF export. */
export function renderPagePng(
  page: InkPage,
  paper: InkPaper,
  width: number,
  assets: PageAssets = NO_ASSETS,
  scale = 1,
  layers: "page" | "ink" = "page",
): Uint8Array | null {
  const surface = Skia.Surface.MakeOffscreen(
    Math.round(width * scale),
    Math.round(page.height * scale),
  );
  if (!surface) return null;
  const canvas = surface.getCanvas();
  canvas.scale(scale, scale);
  canvas.drawPicture(recordPage(page, paper, width, assets, PAPER_PALETTE, layers));
  surface.flush();
  return surface.makeImageSnapshot().encodeToBytes();
}

/** Stylus strokes vary their recorded pressure; finger strokes are recorded at a flat 0.5. */
function hasRealPressure(points: readonly number[]): boolean {
  for (let index = 2; index < points.length; index += 3) if (points[index] !== 0.5) return true;
  return false;
}
