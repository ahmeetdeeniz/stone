import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyFormatting,
  containsUnsafeRawHtml,
  extractTasks,
  normalizeMarkdown,
  parseMarkdown,
  parseSyntaxTree,
  sanitizeExternalUrl,
  sanitizeFileName,
  serializeMarkdown,
  toggleTask,
  validateImportFile,
} from "./index.js";

const fixtureRoot = path.join(findWorkspaceRoot(), "packages/markdown/fixtures");

describe("markdown source boundary", () => {
  it("normalizes transport details without removing meaningful trailing spaces", () => {
    expect(normalizeMarkdown("# Stone\r\n\r\nText  ")).toBe("# Stone\n\nText  \n");
    expect(normalizeMarkdown("\uFEFFTürkçe")).toBe("Türkçe\n");
  });

  it("round-trips nested and unknown YAML frontmatter semantically", () => {
    const parsed = parseMarkdown(
      "---\nstone:\n  schema: 1\n  tags:\n    - mobil\nunknownField:\n  preserveMe: true\n---\n# Fixture",
    );
    expect(parsed.frontmatter).toEqual({
      stone: { schema: 1, tags: ["mobil"] },
      unknownField: { preserveMe: true },
    });
    expect(parseMarkdown(serializeMarkdown(parsed))).toEqual(parsed);
  });

  it("indexes supported blocks, links, callouts, tables, and tasks", () => {
    const source = readFixture("markdown-fixtures.md");
    const tree = parseSyntaxTree(source);
    expect(tree.blocks.map((block) => block.type)).toEqual(
      expect.arrayContaining(["frontmatter", "heading", "list", "callout", "code", "table"]),
    );
    expect(tree.tasks).toHaveLength(2);
    expect(
      tree.tasks.every((task) => source.slice(task.markerFrom, task.markerTo).length === 1),
    ).toBe(true);
    expect(
      tree.blocks.flatMap((block) => block.inline).some((token) => token.type === "link"),
    ).toBe(true);
  });

  it("toggles only the selected task marker and ignores code-block checkboxes", () => {
    const source = "- [ ] first\n\n```md\n- [ ] not a task\n```\n- [x] last\n";
    const tasks = extractTasks(source);
    expect(tasks).toHaveLength(2);
    const updated = toggleTask(source, tasks[0]!, true);
    expect(updated).toBe("- [x] first\n\n```md\n- [ ] not a task\n```\n- [x] last\n");
    expect(toggleTask(updated, tasks[1]!, false)).toBe(
      "- [x] first\n\n```md\n- [ ] not a task\n```\n- [ ] last\n",
    );
  });

  it("supports selection formatting without replacing source with a rich-text model", () => {
    const source = "Türkçe metin\n";
    expect(applyFormatting(source, { from: 0, to: 6 }, "bold")).toBe("**Türkçe** metin\n");
    expect(applyFormatting("**metin**\n", { from: 2, to: 7 }, "bold")).toBe("metin\n");
  });

  it("rejects unsafe links, raw HTML, invalid imports, and unsafe filenames", () => {
    expect(sanitizeExternalUrl("https://example.com")).toBe("https://example.com");
    expect(sanitizeExternalUrl("javascript:alert(1)")).toBeNull();
    expect(sanitizeExternalUrl("custom://outside")).toBeNull();
    expect(containsUnsafeRawHtml("<script>alert(1)</script>")).toBe(true);
    expect(sanitizeFileName("../bad:note?.md")).toBe("-bad-note-.md");
    expect(validateImportFile("note.md", new TextEncoder().encode("# not\n"))).toBe("# not\n");
    expect(() => validateImportFile("note.txt", new Uint8Array([35]))).toThrow();
    expect(() => validateImportFile("note.md", new Uint8Array([0]))).toThrow();
  });

  it("survives malformed Markdown and keeps the large-document fixture usable", () => {
    expect(() => parseSyntaxTree(readFixture("broken.md"))).not.toThrow();
    const largePath = path.join(fixtureRoot, "large-100kb.md");
    expect(statSync(largePath).size).toBeGreaterThanOrEqual(100_000);
    expect(parseSyntaxTree(readFixture("large-100kb.md")).source.length).toBeGreaterThan(100_000);
  });
});

function readFixture(name: string): string {
  return readFileSync(path.join(fixtureRoot, name), "utf8");
}

function findWorkspaceRoot(): string {
  let current = process.cwd();
  while (!existsSync(path.join(current, "pnpm-workspace.yaml"))) {
    const parent = path.dirname(current);
    if (parent === current) throw new Error("Workspace root was not found.");
    current = parent;
  }
  return current;
}
