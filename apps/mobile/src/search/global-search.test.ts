import { describe, expect, it } from "vitest";
import type { CalendarItem, Document, Project, Task } from "@stone/domain";
import { runGlobalSearch, snippet } from "./global-search";

const note = {
  id: "n1",
  title: "Meeting",
  markdown: "# Meeting\n\nDiscuss the **İstanbul** launch plan.",
} as Document;
const task = {
  id: "t1",
  title: "Book İstanbul flight",
  dueDate: "2026-03-03",
  dueTime: "09:00",
} as Task;
const project = {
  id: "p1",
  title: "Launch",
  slug: "launch",
  nextAction: "Prepare İstanbul event",
  tags: ["city"],
  deletedAt: null,
} as unknown as Project;
const event = {
  id: "e1",
  title: "Dinner",
  description: null,
  location: "İstanbul",
  startDate: "2026-03-05",
  deletedAt: null,
} as unknown as CalendarItem;

describe("global search", () => {
  it("groups matches across sources with Turkish-aware folding", async () => {
    const result = await runGlobalSearch(
      {
        searchNotes: () => Promise.resolve([note]),
        searchTasks: () => Promise.resolve([task]),
        listProjects: () => Promise.resolve([project]),
        listCalendar: () => Promise.resolve([event]),
      },
      "istanbul",
    );
    expect(result.notes[0]?.id).toBe("n1");
    expect(result.notes[0]?.detail).toContain("İstanbul");
    expect(result.tasks[0]).toMatchObject({ id: "t1", detail: "2026-03-03 09:00" });
    expect(result.projects.map((hit) => hit.id)).toEqual(["p1"]);
    expect(result.events[0]).toMatchObject({ id: "e1", detail: "2026-03-05 · İstanbul" });
  });

  it("ignores one-character queries and survives a failing source", async () => {
    const sources = {
      searchNotes: () => Promise.reject(new Error("fts broken")),
      searchTasks: () => Promise.resolve([task]),
      listProjects: () => Promise.resolve([]),
      listCalendar: () => Promise.resolve([]),
    };
    expect((await runGlobalSearch(sources, "i")).tasks).toEqual([]);
    const result = await runGlobalSearch(sources, "flight");
    expect(result.notes).toEqual([]);
    expect(result.tasks).toHaveLength(1);
  });

  it("builds a snippet around the match without Markdown syntax", () => {
    const excerpt = snippet("# Title\n\nSome **bold** text about rockets", "rockets", 10);
    expect(excerpt).toMatch(/^….*about rockets$/u);
    expect(excerpt).not.toContain("*");
  });
});
