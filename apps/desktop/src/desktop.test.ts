import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeMarkdown } from "@stone/markdown";

describe("desktop foundation", () => {
  it("preserves Markdown source while normalizing line endings", () => {
    expect(normalizeMarkdown("# Başlık\r\n\r\nmetin")).toBe("# Başlık\n\nmetin\n");
  });

  it("ships the Bongita wordmark font and an anchored application shell", () => {
    const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    expect(existsSync(resolve(desktopRoot, "public/fonts/Bongita-Regular.otf"))).toBe(true);
    const styles = readFileSync(resolve(desktopRoot, "src/styles.css"), "utf8");
    expect(styles).toContain('font-family: "Bongita"');
    expect(styles).toContain("height: 100dvh");
    expect(styles).toContain("overflow: hidden");
  });
});
