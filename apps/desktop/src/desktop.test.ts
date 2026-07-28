import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeMarkdown } from "@stone/markdown";

describe("desktop foundation", () => {
  it("preserves Markdown source while normalizing line endings", () => {
    expect(normalizeMarkdown("# Başlık\r\n\r\nmetin")).toBe("# Başlık\n\nmetin\n");
  });

  it("ships the Bongita wordmark font and an anchored application shell", () => {
    expect(existsSync(resolve(process.cwd(), "public/fonts/Bongita-Regular.otf"))).toBe(true);
    const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    expect(styles).toContain('font-family: "Bongita"');
    expect(styles).toContain("height: 100dvh");
    expect(styles).toContain("overflow: hidden");
  });
});
