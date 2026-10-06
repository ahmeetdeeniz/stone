import { describe, expect, it } from "vitest";
import {
  createNotebook,
  duplicatePage,
  movePage,
  notebookAttachments,
  objectAt,
  parseNotebook,
  placeImage,
  recognizeShape,
  removePage,
  serializeNotebook,
  setPageObjects,
  addPage,
  type InkImage,
  type InkPoint,
  type InkText,
} from "./index.js";

const now = "2026-10-06T10:00:00.000Z";
const json = (value: string) =>
  JSON.parse(value) as Record<string, unknown> & {
    schema: number;
    pages: Array<Record<string, unknown>>;
  };
const file = `${"a".repeat(64)}.png`;
const image: InkImage = {
  id: "img",
  file,
  x: 100,
  y: 120,
  width: 300,
  height: 200,
  createdAt: now,
};
const text: InkText = {
  id: "txt",
  text: "Newton'un 2. yasası: F = m·a",
  x: 120,
  y: 400,
  width: 320,
  height: 28,
  size: 20,
  color: "#1C1917",
  createdAt: now,
};

function notebook() {
  return createNotebook({ id: "nb", title: "Fizik", pageId: "p1", now });
}

describe("page images and text boxes", () => {
  it("writes schema 3 only while a page holds objects, and round-trips them", () => {
    const plain = notebook();
    expect(json(serializeNotebook(plain)).schema).toBe(2);
    const rich = setPageObjects(plain, 0, { images: [image], texts: [text] }, now);
    const written = json(serializeNotebook(rich));
    expect(written.schema).toBe(3);
    expect(parseNotebook(serializeNotebook(rich)).pages[0]).toMatchObject({
      images: [image],
      texts: [text],
    });
    const cleared = setPageObjects(rich, 0, { images: [], texts: [] }, now);
    const back = json(serializeNotebook(cleared));
    expect(back.schema).toBe(2);
    expect(back.pages[0]).not.toHaveProperty("images");
  });

  it("rejects objects that point outside the attachment store or are malformed", () => {
    const bad = (images: unknown) =>
      JSON.stringify({
        ...json(serializeNotebook(notebook())),
        schema: 3,
        pages: [{ id: "p1", height: 1123, strokes: [], shapes: [], images }],
      });
    expect(() => parseNotebook(bad([{ ...image, file: "../secret.png" }]))).toThrow();
    expect(() => parseNotebook(bad([{ ...image, width: -1 }]))).toThrow();
    expect(() => parseNotebook(bad([image, image]))).toThrow();
    expect(() =>
      parseNotebook(JSON.stringify({ ...json(serializeNotebook(notebook())), schema: 4 })),
    ).toThrow();
  });

  it("hits the top-most object and places images inside the page", () => {
    const page = { images: [image], texts: [{ ...text, x: 120, y: 130 }] };
    expect(objectAt(page, 150, 140)?.kind).toBe("text");
    expect(objectAt(page, 380, 300)?.object.id).toBe("img");
    expect(objectAt(page, 10, 10)).toBeNull();
    expect(
      placeImage({ width: 4000, height: 3000 }, { width: 600, height: 800 }, { x: 397, y: 300 }),
    ).toEqual({ x: 97, y: 75, width: 600, height: 450 });
  });

  it("grows an endless page to keep a low object on paper", () => {
    const endless = createNotebook({ id: "nb", title: "x", pageId: "p1", layout: "infinite", now });
    const low = setPageObjects(endless, 0, { images: [{ ...image, y: 1500 }] }, now);
    expect(low.pages[0]!.height).toBeGreaterThanOrEqual(1700 + 1123 / 2);
  });

  it("moves, duplicates and clears pages with their objects", () => {
    let nb = setPageObjects(notebook(), 0, { images: [image], texts: [text] }, now);
    nb = addPage(nb, "p2", 0, now);
    expect(movePage(nb, 0, 1, now).pages.map((page) => page.id)).toEqual(["p2", "p1"]);
    let counter = 0;
    const copy = duplicatePage(nb, 0, () => `new-${(counter += 1)}`, now);
    expect(copy.pages.map((page) => page.id)).toEqual(["p1", "new-1", "p2"]);
    expect(copy.pages[1]!.images![0]!.id).not.toBe("img");
    expect(copy.pages[1]!.images![0]!.file).toBe(file);
    expect(notebookAttachments(copy)).toEqual([file]);
    const single = removePage(setPageObjects(notebook(), 0, { images: [image] }, now), 0, now);
    expect(single.pages[0]).toEqual({ id: "p1", height: 1123, strokes: [], shapes: [] });
  });
});

describe("shape recognition", () => {
  const ring = (cx: number, cy: number, rx: number, ry: number, noise = 0) =>
    Array.from({ length: 73 }, (_, i): InkPoint => {
      const a = (i / 72) * Math.PI * 2;
      const wobble = 1 + Math.sin(i * 1.7) * noise;
      return {
        x: cx + Math.cos(a) * rx * wobble,
        y: cy + Math.sin(a) * ry * wobble,
        pressure: 0.5,
      };
    });
  const polyline = (corners: Array<[number, number]>, steps = 20, noise = 0) =>
    corners.slice(1).flatMap(([x, y], c) => {
      const [px, py] = corners[c]!;
      return Array.from({ length: steps }, (_, i): InkPoint => ({
        x: px + ((x - px) * i) / steps + Math.sin(i + c) * noise,
        y: py + ((y - py) * i) / steps + Math.cos(i * 1.3 + c) * noise,
        pressure: 0.5,
      }));
    });

  it("snaps a wobbly circle to an ellipse and keeps its box", () => {
    const shape = recognizeShape(ring(300, 300, 100, 60, 0.04));
    expect(shape?.kind).toBe("ellipse");
    expect(Math.abs(shape!.from.x - 200)).toBeLessThan(6);
    expect(Math.abs(shape!.to.y - 360)).toBeLessThan(6);
  });

  it("snaps a hand-drawn box to a rectangle and a straight stroke to a line", () => {
    const box = polyline(
      [
        [100, 100],
        [400, 104],
        [398, 300],
        [102, 296],
        [101, 106],
      ],
      20,
      2,
    );
    expect(recognizeShape(box)?.kind).toBe("rectangle");
    const line = recognizeShape(
      polyline(
        [
          [10, 10],
          [300, 160],
        ],
        30,
        1.5,
      ),
    );
    expect(line?.kind).toBe("line");
    expect(Math.abs(line!.from.x - 10) + Math.abs(line!.from.y - 10)).toBeLessThan(4);
  });

  it("leaves handwriting and open curves alone", () => {
    const wave = Array.from({ length: 80 }, (_, i): InkPoint => ({
      x: 100 + i * 4,
      y: 200 + Math.sin(i / 3) * 18,
      pressure: 0.5,
    }));
    expect(recognizeShape(wave)).toBeNull();
    const arc = ring(300, 300, 100, 100).slice(0, 45);
    expect(recognizeShape(arc)).toBeNull();
    expect(recognizeShape(ring(0, 0, 2, 2))).toBeNull();
  });
});
