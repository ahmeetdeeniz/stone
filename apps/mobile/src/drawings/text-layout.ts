/** Line box height for a text size: what both the renderer and the inline editor use. */
export function lineHeightFor(size: number): number {
  return Math.round(size * 1.35);
}

/**
 * Wraps text into lines no wider than `width` (as measured by `measure`), breaking at spaces;
 * a single word longer than the width is broken by characters. Blank lines are kept.
 */
export function layoutText(
  text: string,
  width: number,
  measure: (value: string) => number,
): readonly string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(" ")) {
      const candidate = line ? `${line} ${word}` : word;
      if (measure(candidate) <= width) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      line = "";
      if (measure(word) <= width) {
        line = word;
        continue;
      }
      // The word alone does not fit: break it by characters.
      for (const character of word) {
        if (line && measure(line + character) > width) {
          lines.push(line);
          line = "";
        }
        line += character;
      }
    }
    lines.push(line);
  }
  return lines;
}
