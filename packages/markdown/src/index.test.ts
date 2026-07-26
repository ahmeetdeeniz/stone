import { describe, expect, it } from "vitest";
import { normalizeMarkdown, parseMarkdown, serializeMarkdown } from "./index.js";

describe("markdown boundary", () => {
  it("normalizes line endings without changing markdown semantics", () => {
    expect(normalizeMarkdown("# Stone\r\n\r\nText  ")).toBe("# Stone\n\nText\n");
  });

  it("round-trips known frontmatter values", () => {
    const parsed = parseMarkdown("---\nstone.schema: 1\nkind: note\n---\n# Hello");
    expect(parsed.frontmatter).toEqual({ "stone.schema": "1", kind: "note" });
    expect(parseMarkdown(serializeMarkdown(parsed))).toEqual(parsed);
  });
});
