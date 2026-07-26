import { describe, expect, it } from "vitest";
import { normalizeMarkdown } from "@stone/markdown";

describe("desktop foundation", () => {
  it("preserves Markdown source while normalizing line endings", () => {
    expect(normalizeMarkdown("# Başlık\r\n\r\nmetin")).toBe("# Başlık\n\nmetin\n");
  });
});
