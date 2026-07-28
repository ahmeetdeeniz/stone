import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  extractTasks,
  normalizeMarkdown,
  parseMarkdown,
  parseSyntaxTree,
  toggleTask,
} from "./index.js";

const fixture = readFileSync(
  new URL("../fixtures/live-preview-acceptance.md", import.meta.url),
  "utf8",
);

describe("representative Live Preview Markdown compatibility", () => {
  it("parses common Obsidian-style content without mutating source", () => {
    const document = parseMarkdown(fixture);
    const syntax = parseSyntaxTree(fixture);
    expect(document.frontmatter.title).toBe("Stone kabul planı");
    expect(syntax.blocks.map((block) => block.type)).toEqual(
      expect.arrayContaining([
        "frontmatter",
        "heading",
        "paragraph",
        "list",
        "blockquote",
        "callout",
        "table",
        "code",
        "horizontalRule",
      ]),
    );
    expect(fixture).toContain("[[İç Bağlantı]]");
    expect(normalizeMarkdown(fixture)).toBe(fixture);
  });

  it("toggles only the selected task marker and preserves surrounding structure", () => {
    const task = extractTasks(fixture).find((item) => !item.checked);
    expect(task).toBeDefined();
    const toggled = toggleTask(fixture, task!, true);
    expect(toggled.slice(0, task!.markerFrom)).toBe(fixture.slice(0, task!.markerFrom));
    expect(toggled.slice(task!.markerFrom, task!.markerTo)).toBe("x");
    expect(toggled).toMatch(/<!-- stone-task: \{"id":"tsk_[a-f0-9]+"\} -->/u);
    const withoutGeneratedMetadata = toggled.replace(
      /\n<!-- stone-task: \{"id":"tsk_[a-f0-9]+"\} -->/u,
      "",
    );
    const expected = `${fixture.slice(0, task!.markerFrom)}x${fixture.slice(task!.markerTo)}`;
    expect(withoutGeneratedMetadata).toBe(expected);
    expect(toggled).toContain("[[İç Bağlantı]]");
    expect(parseMarkdown(toggled).frontmatter).toEqual(parseMarkdown(fixture).frontmatter);
  });

  it("keeps empty list items, Turkish text and unsupported syntax editable", () => {
    expect(fixture).toContain("\n-\n");
    expect(fixture).toContain("Türkçe");
    expect(parseMarkdown(fixture).body).toContain("[[İç Bağlantı]]");
  });
});
