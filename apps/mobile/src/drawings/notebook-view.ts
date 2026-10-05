import { getStroke } from "perfect-freehand";
import type { InkPoint } from "@stone/ink";

/** Where the notebook sits on screen: notebook point (x, y) is drawn at (x*scale+dx, y*scale+dy). */
export interface NotebookView {
  dx: number;
  dy: number;
  scale: number;
}

export const MIN_SCALE = 0.3;
export const MAX_SCALE = 4;
const MARGIN = 16;

/**
 * Largest zoom a page opens at. Filling a 14" landscape screen would blow the 32 px rules up to
 * about 12 mm; 1.25 keeps them near the 8 mm of a paper notebook and centres the page instead.
 */
export const MAX_FIT_SCALE = 1.25;

/** Fits the page width into the viewport with a small margin, top-aligned and centred. */
export function fitWidth(viewportWidth: number, pageWidth: number): NotebookView {
  const scale = clamp((viewportWidth - MARGIN * 2) / pageWidth, MIN_SCALE, MAX_FIT_SCALE);
  return { dx: (viewportWidth - pageWidth * scale) / 2, dy: MARGIN, scale };
}

export function toNotebook(view: NotebookView, x: number, y: number): { x: number; y: number } {
  return { x: (x - view.dx) / view.scale, y: (y - view.dy) / view.scale };
}

/**
 * Pinch: scales around the gesture's starting focal point and follows the focal point as it
 * moves, so two fingers both zoom and pan.
 */
export function pinchView(
  start: NotebookView,
  startFocal: { x: number; y: number },
  focal: { x: number; y: number },
  factor: number,
): NotebookView {
  const scale = clamp(start.scale * factor, MIN_SCALE, MAX_SCALE);
  const anchor = toNotebook(start, startFocal.x, startFocal.y);
  return { scale, dx: focal.x - anchor.x * scale, dy: focal.y - anchor.y * scale };
}

/** Keeps at least a quarter of the viewport showing paper so the notebook can't be lost. */
export function clampView(
  view: NotebookView,
  viewport: { width: number; height: number },
  content: { width: number; height: number },
): NotebookView {
  const width = content.width * view.scale;
  const height = content.height * view.scale;
  const keepX = viewport.width / 4;
  const keepY = viewport.height / 4;
  return {
    scale: view.scale,
    dx: clamp(view.dx, keepX - width, viewport.width - keepX),
    dy: clamp(view.dy, keepY - height, viewport.height - keepY),
  };
}

/** Index of the page whose area covers the middle of the viewport (for "page 3 / 12"). */
export function visiblePageIndex(
  view: NotebookView,
  viewportHeight: number,
  offsets: readonly number[],
): number {
  const middle = toNotebook(view, 0, viewportHeight / 2).y;
  let index = 0;
  for (let position = 0; position < offsets.length; position += 1)
    if (offsets[position]! <= middle) index = position;
  return index;
}

/** Visible notebook-space vertical range, padded so pages pop in before they scroll into view. */
export function visibleRange(
  view: NotebookView,
  viewportHeight: number,
): { top: number; bottom: number } {
  const top = toNotebook(view, 0, 0).y;
  const bottom = toNotebook(view, 0, viewportHeight).y;
  const padding = (bottom - top) / 2;
  return { top: top - padding, bottom: bottom + padding };
}

/**
 * Filled outline of a pen stroke whose width follows pen pressure. Touch input has no real
 * pressure, so its pressure is simulated from speed instead. Highlighters keep an even width.
 */
export function strokeOutline(
  points: readonly InkPoint[],
  width: number,
  options: { highlighter?: boolean; realPressure?: boolean; complete?: boolean } = {},
): number[][] {
  return getStroke(
    points.map((point) => [point.x, point.y, point.pressure]),
    {
      size: options.highlighter ? width * 2.5 : width * 1.6,
      thinning: options.highlighter ? 0 : 0.6,
      smoothing: 0.5,
      streamline: 0.4,
      simulatePressure: !options.realPressure && !options.highlighter,
      last: options.complete ?? true,
      start: { cap: true },
      end: { cap: true },
    },
  );
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
