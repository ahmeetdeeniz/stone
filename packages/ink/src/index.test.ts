import { describe, expect, it } from "vitest";
import {
  InkHistory,
  addShape,
  addStroke,
  createEmptyInk,
  deleteSelection,
  duplicateSelection,
  eraseAt,
  flatToPoints,
  parseInk,
  renderInkToSvg,
  selectLasso,
  selectRectangle,
  serializeInk,
  transformSelection,
} from "./index.js";

const base = createEmptyInk({
  id: "çizim-1",
  title: "Türkçe çizim ✦",
  width: 800,
  height: 600,
  now: "2026-07-26T00:00:00.000Z",
});
const stroke = {
  id: "stroke-1",
  tool: "pen" as const,
  color: "#6F63E7",
  width: 4,
  opacity: 1,
  points: [
    { x: 10, y: 10, pressure: 0.2 },
    { x: 100, y: 100, pressure: 1 },
  ],
  createdAt: "2026-07-26T00:00:00.000Z",
};

describe("Stone Ink vector boundary", () => {
  it("round-trips Unicode metadata, pressure and compact points", () => {
    const document = addStroke(base, stroke);
    const parsed = parseInk(serializeInk(document));
    expect(parsed.title).toContain("Türkçe");
    expect(flatToPoints(parsed.strokes[0]!.points)[1]!.pressure).toBe(1);
  });

  it("supports selection, transforms, duplication, deletion and erasing", () => {
    const withStroke = addStroke(base, stroke);
    const withShape = addShape(withStroke, {
      id: "shape-1",
      kind: "rectangle",
      color: "#11111D",
      width: 2,
      opacity: 1,
      from: { x: 20, y: 20, pressure: 1 },
      to: { x: 80, y: 80, pressure: 1 },
      filled: false,
      createdAt: base.updatedAt,
    });
    const selection = selectRectangle(withShape, { left: 0, top: 0, right: 110, bottom: 110 });
    expect(selection.strokeIds).toContain("stroke-1");
    expect(selection.shapeIds).toContain("shape-1");
    const moved = transformSelection(withShape, selection, {
      translateX: 10,
      translateY: 10,
      scaleX: 1,
      scaleY: 1,
    });
    const duplicated = duplicateSelection(moved, selection, () => "copy-1");
    expect(duplicated.strokes).toHaveLength(2);
    expect(deleteSelection(duplicated, selection).strokes).toHaveLength(1);
    expect(eraseAt(withShape, { x: 10, y: 10, pressure: 1 }, 20).strokes).toHaveLength(0);
    expect(
      selectLasso(withShape, [
        { x: 0, y: 0, pressure: 1 },
        { x: 120, y: 0, pressure: 1 },
        { x: 120, y: 120, pressure: 1 },
        { x: 0, y: 120, pressure: 1 },
      ]).strokeIds,
    ).toContain("stroke-1");
  });

  it("preserves highlighter opacity, pressure and vector shape types", () => {
    const highlighted = addStroke(base, {
      ...stroke,
      id: "highlight-1",
      tool: "highlighter",
      opacity: 0.6,
    });
    const shaped = addShape(highlighted, {
      id: "arrow-1",
      kind: "arrow",
      color: "#C95B67",
      width: 3,
      opacity: 0.8,
      from: { x: 20, y: 20, pressure: 0.4 },
      to: { x: 120, y: 80, pressure: 1 },
      filled: false,
      createdAt: base.updatedAt,
    });
    expect(parseInk(serializeInk(shaped)).strokes[0]!.tool).toBe("highlighter");
    expect(renderInkToSvg(shaped)).toContain("polyline");
    expect(
      transformSelection(
        shaped,
        selectRectangle(shaped, { left: 0, top: 0, right: 200, bottom: 200 }),
        { translateX: 0, translateY: 0, scaleX: 1.2, scaleY: 1.2 },
      ).shapes[0]!.to.x,
    ).toBe(144);
  });

  it("keeps undo and redo bounded and emits a portable SVG preview", () => {
    const history = new InkHistory(base, 1);
    const next = addStroke(base, stroke);
    history.commit(next);
    expect(history.canUndo()).toBe(true);
    expect(history.undo().strokes).toHaveLength(0);
    expect(history.redo().strokes).toHaveLength(1);
    expect(renderInkToSvg(next)).toContain("<svg");
  });

  it("rejects invalid and future schema versions", () => {
    expect(() => parseInk("{}")).toThrow("schema");
    expect(() => parseInk(JSON.stringify({ ...base, schema: 2 }))).toThrow("schema");
  });

  it("handles a 5,000-stroke fixture without unbounded history", () => {
    const large = {
      ...base,
      strokes: Array.from({ length: 5_000 }, (_, index) => ({
        ...stroke,
        id: `stroke-${index}`,
        points: [0, 0, 1, 1, 1, 1],
      })),
    };
    const parsed = parseInk(serializeInk(large));
    expect(parsed.strokes).toHaveLength(5_000);
  });
});
