import { describe, expect, it } from "vitest";
import {
  extractDrawingBlocks,
  insertDrawingBlock,
  resolveDrawingSource,
} from "./drawing-blocks.js";

const block = {
  id: "çizim-1",
  title: "Türkçe çizim",
  schema: 1 as const,
  source: "./assets/drawings/çizim-1.stoneink",
  preview: "./assets/drawings/çizim-1.png",
};

describe("portable Stone drawing blocks", () => {
  it("inserts a valid Markdown image and Stone metadata comment", () => {
    const markdown = insertDrawingBlock("# Not\n", block);
    expect(markdown).toContain("![Türkçe çizim](./assets/drawings/çizim-1.png)");
    expect(extractDrawingBlocks(markdown, new Set([block.id]))[0]).toMatchObject({
      id: block.id,
      sourceAvailable: true,
    });
  });

  it("keeps unknown and malformed comments safe", () => {
    const markdown = '<!-- stone-drawing: {"schema":99} -->\n<!-- other: true -->\n';
    expect(extractDrawingBlocks(markdown)).toHaveLength(0);
    expect(markdown).toContain("<!-- other: true -->");
  });

  it("falls back to a non-editable PNG when the source is missing", () => {
    expect(resolveDrawingSource(block, undefined)).toEqual({
      editable: false,
      preview: block.preview,
    });
    expect(resolveDrawingSource(block, '{"schema":1}').editable).toBe(true);
  });
});
