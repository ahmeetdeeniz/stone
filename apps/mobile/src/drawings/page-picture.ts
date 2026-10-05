import {
  BlendMode,
  PaintStyle,
  Skia,
  StrokeCap,
  StrokeJoin,
  type SkCanvas,
  type SkPath,
  type SkPicture,
} from "@shopify/react-native-skia";
import {
  flatToPoints,
  paperGuides,
  type InkPaper,
  type InkPage,
  type InkShape,
  type InkStroke,
} from "@stone/ink";
import { strokeOutline } from "./notebook-view";

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

/** Records a whole page (paper, then shapes and strokes) once; it is redrawn from the picture. */
export function recordPage(
  page: InkPage,
  paper: InkPaper,
  width: number,
  palette: PaperPalette = PAPER_PALETTE,
): SkPicture {
  const recorder = Skia.PictureRecorder();
  const canvas = recorder.beginRecording(Skia.XYWHRect(0, 0, width, page.height));
  drawPaper(canvas, paper, width, page.height, palette);
  for (const shape of page.shapes) drawShape(canvas, shape);
  for (const stroke of page.strokes) drawStroke(canvas, stroke);
  return recorder.finishRecordingAsPicture();
}

/** PNG of one page, used as the drawing preview embedded in notes. */
export function renderPagePng(page: InkPage, paper: InkPaper, width: number): Uint8Array | null {
  const surface = Skia.Surface.MakeOffscreen(Math.round(width), Math.round(page.height));
  if (!surface) return null;
  const canvas = surface.getCanvas();
  canvas.drawPicture(recordPage(page, paper, width));
  surface.flush();
  return surface.makeImageSnapshot().encodeToBytes();
}

/** Stylus strokes vary their recorded pressure; finger strokes are recorded at a flat 0.5. */
function hasRealPressure(points: readonly number[]): boolean {
  for (let index = 2; index < points.length; index += 3) if (points[index] !== 0.5) return true;
  return false;
}
