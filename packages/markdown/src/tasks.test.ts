import { describe, expect, it } from "vitest";
import { extractMarkdownTasks, materializeTaskBlockId, setMarkdownTaskChecked } from "./tasks.js";

describe("Markdown tasks", () => {
  it("extracts portable tasks while excluding fenced code", () => {
    const markdown = [
      "---",
      "title: Tasks",
      "---",
      "- [ ] Real task",
      "```md",
      "- [ ] Not a task",
      "```",
      "1. [X] Done ^stone-task-done",
      "> [!note]",
      "> - [ ] Callout task remains unsupported",
      "",
    ].join("\n");
    expect(extractMarkdownTasks(markdown)).toMatchObject([
      { text: "Real task", checked: false, blockId: null, line: 4 },
      { text: "Done", checked: true, blockId: "stone-task-done", line: 8 },
    ]);
  });

  it("changes only the checkbox and preserves unrelated Markdown exactly", () => {
    const source = "# Plan\n\n- [ ] Ship **Stone**\n\n| a | b |\n| - | - |\n";
    const [task] = extractMarkdownTasks(source);
    const updated = setMarkdownTaskChecked(source, task!, true);
    expect(updated).toBe("# Plan\n\n- [x] Ship **Stone**\n\n| a | b |\n| - | - |\n");
  });

  it("materializes a compact readable identity without rewriting the note", () => {
    const source = "- [ ] First\n- [ ] Second\n";
    const [, second] = extractMarkdownTasks(source);
    const updated = materializeTaskBlockId(source, second!, "stone-task-abc123");
    expect(updated).toBe("- [ ] First\n- [ ] Second ^stone-task-abc123\n");
    expect(extractMarkdownTasks(updated)[1]).toMatchObject({
      text: "Second",
      blockId: "stone-task-abc123",
    });
  });

  it("keeps identity stable when surrounding line numbers move", () => {
    const source = "Intro\n\n- [ ] Move me ^stone-task-move\n";
    const moved = `Another paragraph\n${source}`;
    expect(extractMarkdownTasks(moved)[0]?.blockId).toBe("stone-task-move");
  });

  it("indexes a large workspace note deterministically", () => {
    const source = Array.from({ length: 1_000 }, (_, index) => `- [ ] Task ${index}`).join("\n");
    const first = extractMarkdownTasks(source);
    const second = extractMarkdownTasks(source);
    expect(first).toHaveLength(1_000);
    expect(second.map((task) => task.fingerprint)).toEqual(first.map((task) => task.fingerprint));
  });
});
