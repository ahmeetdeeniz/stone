import { describe, expect, it } from "vitest";
import {
  calculateTaskProgress,
  createProjectDocumentSet,
  createProjectMarkdown,
  createVersionMarkdown,
  extractTasks,
  parseMarkdown,
  parseProjectExport,
  parseProjectFrontmatter,
  parseVersionFrontmatter,
  serializeProjectExport,
  toggleTask,
  updateProjectFrontmatter,
  updateVersionFrontmatter,
  updateTaskMetadata,
} from "./index.js";

describe("project Markdown documents", () => {
  it("generates every documented project template and canonical companion documents", () => {
    for (const template of [
      "blank",
      "general",
      "mobile_app",
      "game",
      "website",
      "programming_tooling",
    ] as const) {
      const source = createProjectMarkdown({ id: "prj_1", title: "Stone", template });
      expect(parseProjectFrontmatter(source)).toMatchObject({ type: "project", id: "prj_1" });
      expect(source).toContain("# Stone");
      if (template === "blank") expect(extractTasks(source)).toHaveLength(0);
    }
    const companions = createProjectDocumentSet();
    expect(companions.inbox).toContain("# Inbox");
    expect(companions.decisions).toContain("# Kararlar");
    expect(companions.releaseChecklist).toContain("# Release Checklist");
    expect(
      parseVersionFrontmatter(
        createVersionMarkdown({ id: "ver_1", projectId: "prj_1", version: "1.0.0" }),
      ),
    ).toMatchObject({
      type: "version",
      projectId: "prj_1",
      version: "1.0.0",
    });
  });

  it("updates known project metadata without dropping unknown frontmatter", () => {
    const source = createProjectMarkdown({
      id: "prj_1",
      title: "Stone",
      template: "general",
    }).replace("\n---\n# Stone", "\nunknown:\n  keep: true\n---\n# Stone");
    const updated = updateProjectFrontmatter(source, {
      status: "testing",
      nextAction: "Testi tamamla",
    });
    expect(parseMarkdown(updated).frontmatter.unknown).toEqual({ keep: true });
    expect(parseProjectFrontmatter(updated)).toMatchObject({
      status: "testing",
      nextAction: "Testi tamamla",
    });
  });

  it("preserves unknown version and nested platform frontmatter fields", () => {
    const source = createVersionMarkdown({
      id: "ver_1",
      projectId: "prj_1",
      version: "1.0.0",
    }).replace(
      "ios: not_planned",
      "ios: not_planned\n    custom: keep-me\n  customField:\n    preserve: true",
    );
    const updated = updateVersionFrontmatter(source, {
      platforms: { android: "review", ios: "not_planned" },
      status: "testing",
    });
    expect(parseVersionFrontmatter(updated)).toMatchObject({
      status: "testing",
      platforms: { android: "review", ios: "not_planned", custom: "keep-me" },
      customField: { preserve: true },
    });
  });

  it("keeps task metadata readable, stable, and out of fenced-code progress", () => {
    const source = "- [ ] gerçek görev\n\n```md\n- [ ] örnek değil\n```\n";
    const task = extractTasks(source)[0]!;
    const completed = toggleTask(source, task, true);
    const tasks = extractTasks(completed);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.metadata?.id).toMatch(/^tsk_/u);
    expect(calculateTaskProgress(completed)).toMatchObject({ completed: 1, total: 1, ratio: 1 });
    const withDueDate = updateTaskMetadata(completed, tasks[0]!, {
      due: "2026-08-10",
      priority: "high",
    });
    expect(extractTasks(withDueDate)[0]?.metadata).toMatchObject({
      due: "2026-08-10",
      priority: "high",
    });
  });

  it("excludes canceled tasks from deterministic progress", () => {
    const source =
      '- [x] done\n<!-- stone-task: {"id":"tsk_done"} -->\n\n' +
      '- [ ] canceled\n<!-- stone-task: {"id":"tsk_cancel","canceled":true} -->\n';
    expect(calculateTaskProgress(source)).toEqual({ completed: 1, total: 1, ratio: 1 });
  });

  it("round-trips a readable project export without changing file boundaries", () => {
    const files = [
      { path: "Projects/stone/Project.md", content: "---\nstone: {}\n---\n# Stone\n" },
      { path: "Projects/stone/Versions/1.0.0.md", content: "# v1.0.0\n" },
    ] as const;
    expect(parseProjectExport(serializeProjectExport(files))).toEqual(files);
  });
});
