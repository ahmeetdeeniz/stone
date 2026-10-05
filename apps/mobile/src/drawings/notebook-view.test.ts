import { describe, expect, it } from "vitest";
import {
  MAX_SCALE,
  clampView,
  fitWidth,
  pinchView,
  strokeOutline,
  toNotebook,
  visiblePageIndex,
  visibleRange,
} from "./notebook-view";

describe("notebook viewport math", () => {
  it("fits the page width and maps screen points back to the notebook", () => {
    const view = fitWidth(826, 794);
    expect(view.scale).toBeCloseTo(1);
    expect(toNotebook(view, view.dx + 100, view.dy + 50)).toEqual({ x: 100, y: 50 });
    const zoomed = { dx: 10, dy: 20, scale: 2 };
    expect(toNotebook(zoomed, 210, 220)).toEqual({ x: 100, y: 100 });
    const tablet = fitWidth(1480, 794);
    expect(tablet.scale).toBe(1.25);
    expect(tablet.dx).toBeCloseTo((1480 - 794 * 1.25) / 2);
  });

  it("zooms around the pinch focal point and follows it", () => {
    const start = { dx: 0, dy: 0, scale: 1 };
    const zoomed = pinchView(start, { x: 100, y: 100 }, { x: 100, y: 100 }, 2);
    expect(toNotebook(zoomed, 100, 100)).toEqual({ x: 100, y: 100 });
    const moved = pinchView(start, { x: 100, y: 100 }, { x: 150, y: 80 }, 1);
    expect(moved).toEqual({ dx: 50, dy: -20, scale: 1 });
    expect(pinchView(start, { x: 0, y: 0 }, { x: 0, y: 0 }, 100).scale).toBe(MAX_SCALE);
  });

  it("keeps part of the notebook on screen", () => {
    const viewport = { width: 800, height: 1000 };
    const content = { width: 794, height: 3000 };
    const lost = clampView({ dx: 5000, dy: -9000, scale: 1 }, viewport, content);
    expect(lost.dx).toBe(600);
    expect(lost.dy).toBe(250 - 3000);
  });

  it("reports the page in the middle of the screen and the range to render", () => {
    const offsets = [0, 1147, 2294];
    expect(visiblePageIndex({ dx: 0, dy: 0, scale: 1 }, 1000, offsets)).toBe(0);
    expect(visiblePageIndex({ dx: 0, dy: -1500, scale: 1 }, 1000, offsets)).toBe(1);
    expect(visibleRange({ dx: 0, dy: -1000, scale: 1 }, 1000)).toEqual({ top: 500, bottom: 2500 });
  });

  it("outlines strokes so higher pressure draws wider", () => {
    const points = (pressure: number) =>
      Array.from({ length: 10 }, (_, index) => ({ x: index * 10, y: 0, pressure }));
    const width = (outline: number[][]) =>
      Math.max(...outline.map((point) => point[1]!)) -
      Math.min(...outline.map((point) => point[1]!));
    const light = strokeOutline(points(0.1), 4, { realPressure: true });
    const heavy = strokeOutline(points(1), 4, { realPressure: true });
    expect(light.length).toBeGreaterThan(4);
    expect(width(heavy)).toBeGreaterThan(width(light));
  });
});
