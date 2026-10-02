import { describe, expect, it } from "vitest";
import {
  extractWikiLinks,
  normalizeNoteTitle,
  parseSyntaxTree,
  parseWikiLinkUrl,
  wikiLinkUrl,
} from "./index.js";

describe("wiki links", () => {
  it("extracts targets and aliases outside code", () => {
    const markdown = [
      "See [[Project Plan]] and [[Groceries|the list]].",
      "`[[not a link]]`",
      "```",
      "[[also not]]",
      "```",
      "[normal](https://example.com) and [[ Spaced  Title ]]",
    ].join("\n");
    expect(extractWikiLinks(markdown)).toEqual([
      { target: "Project Plan", alias: null },
      { target: "Groceries", alias: "the list" },
      { target: "Spaced  Title", alias: null },
    ]);
  });

  it("round-trips the in-app link URL, including Turkish and reserved characters", () => {
    const url = wikiLinkUrl("Toplantı / Ağustos?");
    expect(url.startsWith("stone-note:")).toBe(true);
    expect(parseWikiLinkUrl(url)).toBe("Toplantı / Ağustos?");
    expect(parseWikiLinkUrl("https://example.com")).toBeNull();
    expect(parseWikiLinkUrl("stone-note:%E0%A4%A")).toBeNull();
  });

  it("normalises titles for matching", () => {
    expect(normalizeNoteTitle("  İSTANBUL   Notları ")).toBe(
      normalizeNoteTitle("istanbul notları"),
    );
  });

  it("emits wikiLink inline tokens with the alias as label and leaves markdown links intact", () => {
    const source = "Go to [[Plan|our plan]] or [site](https://x.dev)\n";
    const tokens = parseSyntaxTree(source).blocks.flatMap((block) => block.inline);
    expect(tokens.find((token) => token.type === "wikiLink")).toMatchObject({
      label: "our plan",
      url: wikiLinkUrl("Plan"),
    });
    expect(tokens.find((token) => token.type === "link")).toMatchObject({
      label: "site",
      url: "https://x.dev",
    });
  });
});
