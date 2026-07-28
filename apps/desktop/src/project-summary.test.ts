import { describe, expect, it } from "vitest";
import { createProjectMarkdown, createVersionMarkdown } from "@stone/markdown";
import type { DesktopDocument } from "./desktop-api";
import { buildProjectSummaries, buildTodayItems } from "./project-summary";

function document(id: string, title: string, markdown: string, updatedAt: string): DesktopDocument {
  return { id, title, markdown, path: null, revision: 1, updatedAt };
}

describe("desktop project summaries", () => {
  it("derives project, progress, version and Today data from portable Markdown", () => {
    const projectSource = createProjectMarkdown({
      id: "project-1",
      title: "Stone",
      template: "blank",
      status: "development",
      priority: "high",
      targetDate: "2026-08-01",
      nextAction: "Release doğrulamasını tamamla",
    }).replace(
      "# Stone\n",
      '# Stone\n\n- [x] Tamamlandı\n- [ ] Engel\n<!-- stone-task: {"blocked":true,"blocker":"Windows doğrulaması"} -->\n',
    );
    const documents = [
      document("note", "Sıradan not", "# Not\n", "2026-07-27T10:00:00Z"),
      document("project-document", "Stone", projectSource, "2026-07-28T10:00:00Z"),
      document(
        "version-document",
        "1.0.0",
        createVersionMarkdown({ id: "version-1", projectId: "project-1", version: "1.0.0" }),
        "2026-07-28T11:00:00Z",
      ),
    ];

    const projects = buildProjectSummaries(documents);
    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({
      title: "Stone",
      completedTasks: 1,
      totalTasks: 2,
      blockers: ["Windows doğrulaması"],
      versions: ["1.0.0"],
    });
    expect(buildTodayItems(projects, new Date("2026-07-28T12:00:00Z"))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "blocker", text: "Windows doğrulaması" }),
        expect.objectContaining({ kind: "target", targetDate: "2026-08-01" }),
        expect.objectContaining({ kind: "next_action", text: "Release doğrulamasını tamamla" }),
      ]),
    );
  });
});
