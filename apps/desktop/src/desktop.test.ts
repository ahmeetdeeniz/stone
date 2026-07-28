import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeMarkdown } from "@stone/markdown";

describe("desktop foundation", () => {
  it("preserves Markdown source while normalizing line endings", () => {
    expect(normalizeMarkdown("# Başlık\r\n\r\nmetin")).toBe("# Başlık\n\nmetin\n");
  });

  it("uses the redistribution-safe Inter wordmark and an anchored application shell", () => {
    const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const styles = readFileSync(resolve(desktopRoot, "src/styles.css"), "utf8");
    expect(styles).toContain("font-family: Inter, ui-sans-serif, system-ui, sans-serif");
    expect(styles).toContain("height: 100dvh");
    expect(styles).toContain("overflow: hidden");
  });

  it("defines independent scroll owners and an intentional minimum-window fallback", () => {
    const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const styles = readFileSync(resolve(desktopRoot, "src/styles.css"), "utf8");
    const config = readFileSync(resolve(desktopRoot, "src-tauri/tauri.conf.json"), "utf8");
    expect(styles).toMatch(/\.document-list\s*\{[^}]*overflow-y:\s*auto/s);
    expect(styles).toMatch(/\.editor-host\s*\{[^}]*overflow:\s*hidden/s);
    expect(styles).toMatch(/\.cm-scroller\s*\{[^}]*overflow:\s*auto/s);
    expect(styles).toMatch(
      /@media \(max-width:\s*1180px\)[\s\S]*grid-template-columns:\s*220px minmax\(0,\s*1fr\)/,
    );
    expect(config).toMatch(/"minWidth":\s*960/);
    expect(config).toMatch(/"minHeight":\s*640/);
  });
});
