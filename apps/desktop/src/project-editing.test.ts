import { describe, expect, it } from "vitest";
import { parseProjectFrontmatter } from "@stone/markdown";
import {
  applyProjectChanges,
  createDesktopProject,
  isLinkedFilePath,
  optionalText,
} from "./project-editing";

function ids() {
  let next = 0;
  return () => `id-${++next}`;
}

describe("desktop project editing", () => {
  it("creates the same project workspace as mobile", () => {
    const { project, documents } = createDesktopProject({
      title: "  Çiçek Bahçesi ",
      template: "general",
      now: "2026-10-02T10:00:00.000Z",
      newId: ids(),
    });
    expect(project).toMatchObject({
      id: "id-1",
      canonicalDocumentId: "id-2",
      title: "Çiçek Bahçesi",
      slug: "cicek-bahcesi",
      status: "planning",
    });
    expect(documents.map((document) => [document.kind, document.path])).toEqual([
      ["project", "Projects/cicek-bahcesi/Project.md"],
      ["inbox", "Projects/cicek-bahcesi/Inbox.md"],
      ["decision_log", "Projects/cicek-bahcesi/Decisions.md"],
      ["release_checklist", "Projects/cicek-bahcesi/Release-Checklist.md"],
    ]);
    expect(documents.every((document) => document.projectId === "id-1")).toBe(true);
    expect(parseProjectFrontmatter(documents[0]!.markdown)).toMatchObject({ id: "id-1" });
  });

  it("updates the entity and Project.md together", () => {
    const { project, documents } = createDesktopProject({
      title: "Stone",
      template: "blank",
      now: "2026-10-02T10:00:00.000Z",
      newId: ids(),
    });
    const result = applyProjectChanges(project, documents[0]!.markdown, {
      title: "Stone 2",
      status: "active",
      nextAction: "Ship desktop parity",
      targetDate: "2026-12-01",
    });
    expect(result.project).toMatchObject({ title: "Stone 2", status: "active" });
    expect(parseProjectFrontmatter(result.markdown)).toMatchObject({
      status: "active",
      nextAction: "Ship desktop parity",
      targetDate: "2026-12-01",
    });
    expect(result.markdown).toContain("# Stone 2");
  });

  it("keeps the title when the field is cleared", () => {
    const { project, documents } = createDesktopProject({
      title: "Stone",
      template: "blank",
      now: "2026-10-02T10:00:00.000Z",
      newId: ids(),
    });
    expect(
      applyProjectChanges(project, documents[0]!.markdown, { title: "  " }).project.title,
    ).toBe("Stone");
  });

  it("treats only absolute paths as linked files", () => {
    expect(isLinkedFilePath("C:\\notes\\a.md")).toBe(true);
    expect(isLinkedFilePath("/home/me/a.md")).toBe(true);
    expect(isLinkedFilePath("\\\\server\\share\\a.md")).toBe(true);
    expect(isLinkedFilePath("Projects/stone/Project.md")).toBe(false);
    expect(isLinkedFilePath(null)).toBe(false);
  });

  it("maps blank form fields to null", () => {
    expect(optionalText("  ")).toBeNull();
    expect(optionalText(" v1 ")).toBe("v1");
  });
});
