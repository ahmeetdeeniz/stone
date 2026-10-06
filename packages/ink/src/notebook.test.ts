import { describe, expect, it } from "vitest";
import { addStroke, createEmptyInk, serializeInk } from "./index.js";
import {
  A4_PAGE,
  PAGE_GAP,
  addPage,
  createNotebook,
  locatePoint,
  notebookHeight,
  pageDocument,
  pageOffsets,
  paperGuides,
  parseNotebook,
  removePage,
  replacePage,
  serializeNotebook,
} from "./notebook.js";

const now = "2026-10-05T00:00:00.000Z";
const pen = (points: Array<[number, number, number]>) => ({
  id: `s-${points[0]![0]}-${points[0]![1]}`,
  tool: "pen" as const,
  color: "#1C1917",
  width: 3,
  opacity: 1,
  points: points.map(([x, y, pressure]) => ({ x, y, pressure })),
  createdAt: now,
});

describe("Stone Ink notebooks", () => {
  it("creates an A4 lined notebook and round-trips it compactly", () => {
    const notebook = createNotebook({ id: "nb", title: "Fizik 101", pageId: "p1", now });
    expect(notebook).toMatchObject({ layout: "pages", paper: "lined", pageWidth: A4_PAGE.width });
    const edited = replacePage(
      notebook,
      0,
      addStroke(
        pageDocument(notebook, 0),
        pen([
          [10.123456, 20.987654, 0.123456],
          [40, 50, 0.9],
        ]),
        now,
      ),
    );
    const json = serializeNotebook(edited);
    expect(json).toContain("[10.1,21,0.12");
    expect(parseNotebook(json).pages[0]!.strokes).toHaveLength(1);
  });

  it("opens schema 1 drawings as a one-page blank notebook", () => {
    const legacy = addStroke(
      createEmptyInk({ id: "old", title: "Eski", width: 900, height: 650, now }),
      pen([
        [1, 1, 1],
        [5, 5, 1],
      ]),
      now,
    );
    const notebook = parseNotebook(serializeInk(legacy));
    expect(notebook).toMatchObject({ paper: "blank", pageWidth: 900, pageHeight: 650 });
    expect(notebook.pages).toHaveLength(1);
    expect(notebook.pages[0]!.strokes).toHaveLength(1);
  });

  it("adds and removes pages but never leaves a notebook empty", () => {
    let notebook = createNotebook({ id: "nb", title: "Not", pageId: "p1", now });
    notebook = addPage(notebook, "p2", 0, now);
    notebook = addPage(notebook, "p0", -1, now);
    expect(notebook.pages.map((page) => page.id)).toEqual(["p0", "p1", "p2"]);
    expect(() => addPage(notebook, "p1")).toThrow(/unique/u);
    notebook = removePage(notebook, 0, now);
    notebook = removePage(notebook, 0, now);
    notebook = replacePage(
      notebook,
      0,
      addStroke(
        pageDocument(notebook, 0),
        pen([
          [1, 1, 1],
          [5, 5, 1],
        ]),
        now,
      ),
    );
    const cleared = removePage(notebook, 0, now);
    expect(cleared.pages).toHaveLength(1);
    expect(cleared.pages[0]!.strokes).toHaveLength(0);
  });

  it("grows infinite pages as ink approaches the bottom", () => {
    const notebook = createNotebook({
      id: "nb",
      title: "Sonsuz",
      pageId: "p1",
      layout: "infinite",
      now,
    });
    const near = replacePage(
      notebook,
      0,
      addStroke(
        pageDocument(notebook, 0),
        pen([
          [10, 1000, 1],
          [20, 1100, 1],
        ]),
        now,
      ),
    );
    expect(near.pages[0]!.height).toBeGreaterThan(A4_PAGE.height);
    expect(near.pages[0]!.height - 1100).toBeGreaterThanOrEqual(A4_PAGE.height / 2);
    const paged = createNotebook({ id: "nb", title: "Sayfa", pageId: "p1", now });
    expect(
      replacePage(
        paged,
        0,
        addStroke(
          pageDocument(paged, 0),
          pen([
            [10, 1000, 1],
            [20, 1100, 1],
          ]),
          now,
        ),
      ).pages[0]!.height,
    ).toBe(A4_PAGE.height);
  });

  it("stacks pages and maps notebook points back to a page", () => {
    const notebook = addPage(createNotebook({ id: "nb", title: "Not", pageId: "p1", now }), "p2");
    expect(pageOffsets(notebook)).toEqual([0, A4_PAGE.height + PAGE_GAP]);
    expect(notebookHeight(notebook)).toBe(A4_PAGE.height * 2 + PAGE_GAP);
    expect(locatePoint(notebook, 100, A4_PAGE.height + PAGE_GAP + 10)).toEqual({
      pageIndex: 1,
      x: 100,
      y: 10,
    });
    expect(locatePoint(notebook, 100, A4_PAGE.height + 5)).toBeNull();
    expect(locatePoint(notebook, -1, 10)).toBeNull();
  });

  it("describes paper guides for every style", () => {
    expect(paperGuides("blank", 794, 1123)).toEqual({ lines: [], dots: [] });
    expect(paperGuides("lined", 794, 1123).lines.some((line) => line.accent)).toBe(true);
    expect(paperGuides("grid", 794, 1123).lines.length).toBeGreaterThan(70);
    expect(paperGuides("dotted", 794, 1123).dots.length).toBeGreaterThan(1000);
    const cornell = paperGuides("cornell", 794, 1123).lines.filter((line) => line.accent);
    expect(cornell).toHaveLength(3);
  });

  it("rejects malformed notebooks", () => {
    const valid = JSON.parse(
      serializeNotebook(createNotebook({ id: "nb", title: "Not", pageId: "p1", now })),
    ) as Record<string, unknown>;
    expect(() => parseNotebook(JSON.stringify({ ...valid, paper: "papyrus" }))).toThrow();
    expect(() => parseNotebook(JSON.stringify({ ...valid, pages: [] }))).toThrow();
    expect(() => parseNotebook(JSON.stringify({ ...valid, schema: 4 }))).toThrow(/schema/u);
  });
});
