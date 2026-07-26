export interface MarkdownDocument {
  frontmatter: Readonly<Record<string, string>>;
  body: string;
}

export function normalizeMarkdown(source: string): string {
  return source.replace(/\r\n?/g, "\n").replace(/\s+$/u, "") + "\n";
}

export function parseMarkdown(source: string): MarkdownDocument {
  const normalized = normalizeMarkdown(source);
  if (!normalized.startsWith("---\n")) {
    return { frontmatter: {}, body: normalized };
  }

  const end = normalized.indexOf("\n---\n", 4);
  if (end === -1) {
    return { frontmatter: {}, body: normalized };
  }

  const frontmatter: Record<string, string> = {};
  for (const line of normalized.slice(4, end).split("\n")) {
    const separator = line.indexOf(":");
    if (separator > 0) {
      frontmatter[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
    }
  }

  return { frontmatter, body: normalized.slice(end + 5) };
}

export function serializeMarkdown(document: MarkdownDocument): string {
  const entries = Object.entries(document.frontmatter);
  if (entries.length === 0) {
    return normalizeMarkdown(document.body);
  }

  const header = entries.map(([key, value]) => `${key}: ${value}`).join("\n");
  return normalizeMarkdown(`---\n${header}\n---\n${document.body}`);
}
