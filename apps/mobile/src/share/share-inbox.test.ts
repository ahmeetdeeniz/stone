import { describe, expect, it } from "vitest";
import { appendInboxEntry, formatShareEntry } from "./share-inbox";

const stamp = "2026-03-02 14:05";

describe("share inbox", () => {
  it("links shared pages with their title and drops the duplicated URL from the text", () => {
    expect(
      formatShareEntry(
        {
          text: "Read this https://example.com/post",
          webUrl: "https://example.com/post",
          meta: { title: "Great [post]" },
        },
        stamp,
      ),
    ).toBe("- [ ] [Great \\[post\\]](https://example.com/post) — Read this · 2026-03-02 14:05");
  });

  it("falls back to the host name and keeps plain text as-is", () => {
    expect(formatShareEntry({ webUrl: "https://www.example.com/a" }, stamp)).toBe(
      "- [ ] [example.com](https://www.example.com/a) · 2026-03-02 14:05",
    );
    expect(formatShareEntry({ text: "  buy\n milk " }, stamp)).toBe(
      "- [ ] buy milk · 2026-03-02 14:05",
    );
  });

  it("never links non-http URLs and ignores empty shares", () => {
    expect(formatShareEntry({ webUrl: "javascript:alert(1)", text: "x" }, stamp)).toBe(
      "- [ ] x · 2026-03-02 14:05",
    );
    expect(formatShareEntry({ text: "   " }, stamp)).toBeNull();
  });

  it("appends to the end of the note, grouping consecutive entries", () => {
    const first = appendInboxEntry("# Inbox\n", "- [ ] a");
    expect(first).toBe("# Inbox\n\n- [ ] a\n");
    expect(appendInboxEntry(first, "- [ ] b")).toBe("# Inbox\n\n- [ ] a\n- [ ] b\n");
  });
});
