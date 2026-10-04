/** What another app shared into Stone (the subset of expo-share-intent's payload we use). */
export interface SharedContent {
  text?: string | null;
  webUrl?: string | null;
  meta?: { title?: string | null } | null;
}

const MAX_SHARED_TEXT = 4_000;

/**
 * Turns shared content into one Markdown task line for the Inbox note, so it shows up in the task
 * index until processed: `- [ ] [Title](https://…) · 2026-03-02 14:05`.
 * Returns null when nothing usable was shared.
 */
export function formatShareEntry(content: SharedContent, stamp: string): string | null {
  const url = safeUrl(content.webUrl);
  const title = clean(content.meta?.title);
  let text = clean(content.text);
  // Many apps share "Title https://link"; drop the URL from the text when we link it anyway.
  if (url && text) text = clean(text.replace(url, ""));
  const label = title ?? text ?? null;
  let body: string;
  if (url) body = `[${escapeLinkText(label ?? hostname(url))}](${url})`;
  else if (text) body = text;
  else return null;
  if (url && text && title && text !== title) body = `${body} — ${text}`;
  return `- [ ] ${body} · ${stamp}`;
}

/** Appends an entry under the note's content, keeping exactly one blank line before the list. */
export function appendInboxEntry(markdown: string, entry: string): string {
  const trimmed = markdown.replace(/\s+$/u, "");
  const lastLine = trimmed.split("\n").at(-1) ?? "";
  const separator = /^\s*- \[[ xX]\] /u.test(lastLine) ? "\n" : "\n\n";
  return `${trimmed}${separator}${entry}\n`;
}

function clean(value: string | null | undefined): string | null {
  if (!value) return null;
  const single = value.replace(/\s+/gu, " ").trim().slice(0, MAX_SHARED_TEXT);
  return single || null;
}

/** Only http(s) links are linked; anything else stays plain text. */
function safeUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function hostname(url: string): string {
  return new URL(url).hostname.replace(/^www\./u, "");
}

function escapeLinkText(value: string): string {
  return value.replace(/[[\]]/gu, (character) => `\\${character}`);
}
