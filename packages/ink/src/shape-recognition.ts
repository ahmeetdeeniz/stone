import type { InkPoint, InkShapeKind } from "./index.js";

export interface RecognizedShape {
  kind: Extract<InkShapeKind, "line" | "ellipse" | "rectangle">;
  from: InkPoint;
  to: InkPoint;
}

/**
 * Turns a hand-drawn stroke into the shape it most likely is, the way note apps snap a stroke
 * when the pen holds still at its end: a nearly straight stroke becomes a line; a closed stroke
 * becomes an ellipse when its points sit on the inscribed ellipse, or a rectangle when they hug
 * the bounding box instead. Returns null for anything else (handwriting, open curves).
 */
export function recognizeShape(points: readonly InkPoint[]): RecognizedShape | null {
  if (points.length < 4) return null;
  const first = points[0]!;
  const last = points.at(-1)!;
  let length = 0;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index]!;
    left = Math.min(left, point.x);
    top = Math.min(top, point.y);
    right = Math.max(right, point.x);
    bottom = Math.max(bottom, point.y);
    if (index > 0) length += distance(points[index - 1]!, point);
  }
  const width = right - left;
  const height = bottom - top;
  if (length < 24) return null;

  const pressure = 0.5;
  if (distance(first, last) / length > 0.94) {
    return {
      kind: "line",
      from: { x: first.x, y: first.y, pressure },
      to: { x: last.x, y: last.y, pressure },
    };
  }

  // Closed shapes: the ends meet (within a fifth of the size) and the stroke goes all round.
  const size = Math.max(width, height);
  if (Math.min(width, height) < 16 || distance(first, last) > size * 0.25) return null;
  if (length < (width + height) * 1.6) return null;

  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;
  const rx = width / 2;
  const ry = height / 2;
  let ellipseError = 0;
  let boxError = 0;
  for (const point of points) {
    const dx = (point.x - cx) / rx;
    const dy = (point.y - cy) / ry;
    ellipseError += Math.abs(Math.hypot(dx, dy) - 1);
    const edge = Math.min(point.x - left, right - point.x, point.y - top, bottom - point.y);
    boxError += Math.max(0, edge) / Math.min(width, height);
  }
  ellipseError /= points.length;
  boxError /= points.length;
  const box = {
    from: { x: left, y: top, pressure },
    to: { x: right, y: bottom, pressure },
  };
  // A circle stays close to radius 1 everywhere; a rectangle's corners reach √2.
  if (ellipseError < 0.09) return { kind: "ellipse", ...box };
  if (boxError < 0.045) return { kind: "rectangle", ...box };
  return null;
}

function distance(a: InkPoint, b: InkPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
