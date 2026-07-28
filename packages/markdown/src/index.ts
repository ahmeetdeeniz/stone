import { parseDocument, stringify } from "yaml";

export type FrontmatterPrimitive = string | number | boolean | null;
export type FrontmatterValue =
  | FrontmatterPrimitive
  | ReadonlyArray<FrontmatterValue>
  | { readonly [key: string]: FrontmatterValue };

export interface MarkdownDocument {
  frontmatter: Readonly<Record<string, FrontmatterValue>>;
  body: string;
}

export class MarkdownParseError extends Error {
  public override readonly name = "MarkdownParseError";
}

export type MarkdownBlockType =
  | "frontmatter"
  | "heading"
  | "paragraph"
  | "list"
  | "blockquote"
  | "callout"
  | "code"
  | "table"
  | "horizontalRule";

export interface MarkdownInlineToken {
  type: "strong" | "emphasis" | "strike" | "inlineCode" | "link";
  from: number;
  to: number;
  markerFrom: number;
  markerTo: number;
  label?: string;
  url?: string;
}

export interface StoneTaskMetadata {
  id?: string;
  priority?: "low" | "medium" | "high" | "critical";
  due?: string;
  blocked?: boolean;
  blocker?: string | null;
  canceled?: boolean;
  readonly [key: string]: FrontmatterValue | undefined;
}

export interface MarkdownTask {
  id: string;
  from: number;
  to: number;
  markerFrom: number;
  markerTo: number;
  checked: boolean;
  text: string;
  metadata?: StoneTaskMetadata;
  metadataFrom?: number;
  metadataTo?: number;
  canceled: boolean;
}

export interface MarkdownBlock {
  type: MarkdownBlockType;
  from: number;
  to: number;
  lineFrom: number;
  lineTo: number;
  text: string;
  level?: number;
  language?: string;
  calloutType?: string;
  calloutTitle?: string;
  task?: MarkdownTask;
  inline: readonly MarkdownInlineToken[];
}

export interface MarkdownSyntaxTree {
  source: string;
  blocks: readonly MarkdownBlock[];
  tasks: readonly MarkdownTask[];
}

export interface TextRange {
  from: number;
  to: number;
}

export type FormattingKind = "bold" | "italic" | "strike" | "inlineCode";

const supportedImportExtensions = new Set([".md", ".markdown"]);
const unsafeUrlScheme = /^(?:javascript|data|vbscript|file|blob):/iu;
const rawHtml = /<\/?[a-z][^>]*>/iu;

export function normalizeMarkdown(source: string): string {
  const withoutBom = source.replace(/^\uFEFF/u, "");
  const normalized = withoutBom.replace(/\r\n?/gu, "\n");
  return normalized.endsWith("\n") ? normalized : `${normalized}\n`;
}

export function parseMarkdown(source: string): MarkdownDocument {
  const normalized = normalizeMarkdown(source);
  const range = findFrontmatterRange(normalized);
  if (!range) return { frontmatter: {}, body: normalized };

  const yamlSource = normalized.slice(range.contentFrom, range.contentTo);
  const document = parseDocument(yamlSource, { strict: true });
  if (document.errors.length > 0) {
    throw new MarkdownParseError(document.errors[0]?.message ?? "Invalid YAML frontmatter.");
  }
  const value = document.toJSON() as unknown;
  if (!isFrontmatterRecord(value)) {
    throw new MarkdownParseError("Frontmatter must be a YAML object.");
  }
  return {
    frontmatter: value,
    body: normalized.slice(range.bodyFrom),
  };
}

export function serializeMarkdown(document: MarkdownDocument): string {
  const entries = Object.keys(document.frontmatter);
  const body = normalizeMarkdown(document.body);
  if (entries.length === 0) return body;
  const header = stringify(document.frontmatter, { lineWidth: 0 }).replace(/\n$/u, "");
  return normalizeMarkdown(`---\n${header}\n---\n${body}`);
}

export function parseSyntaxTree(source: string): MarkdownSyntaxTree {
  const normalized = normalizeMarkdown(source);
  const lines = getLines(normalized);
  const blocks: MarkdownBlock[] = [];
  const frontmatter = findFrontmatterRange(normalized);
  if (frontmatter) {
    blocks.push({
      type: "frontmatter",
      from: 0,
      to: frontmatter.bodyFrom,
      lineFrom: 0,
      lineTo: frontmatter.endLine,
      text: normalized.slice(0, frontmatter.bodyFrom),
      inline: [],
    });
  }

  let index = frontmatter ? frontmatter.endLine + 1 : 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line || /^\s*$/u.test(line.content)) {
      index += 1;
      continue;
    }

    const fence = line.content.match(/^\s*(`{3,}|~{3,})(.*)$/u);
    if (fence) {
      const marker = fence[1]!;
      const fenceCharacter = marker[0]!;
      let end = index + 1;
      while (
        end < lines.length &&
        !new RegExp(`^\\s*${escapeRegExp(fenceCharacter)}{${marker.length},}\\s*$`, "u").test(
          lines[end]!.content,
        )
      ) {
        end += 1;
      }
      const blockEnd = end < lines.length ? lines[end]!.end : lines[lines.length - 1]!.end;
      const blockLineTo = end < lines.length ? end : lines.length - 1;
      const language = fence[2]?.trim();
      blocks.push(
        makeBlock(
          "code",
          lines,
          index,
          blockLineTo,
          normalized,
          language ? { language } : {},
          blockEnd,
        ),
      );
      index = Math.min(end + 1, lines.length);
      continue;
    }

    const heading = line.content.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/u);
    if (heading) {
      blocks.push(
        makeBlock("heading", lines, index, index, normalized, {
          level: heading[1]!.length,
        }),
      );
      index += 1;
      continue;
    }

    if (/^\s{0,3}(?:\*\s*){3,}$|^\s{0,3}(?:-\s*){3,}$|^\s{0,3}(?:_\s*){3,}$/u.test(line.content)) {
      blocks.push(makeBlock("horizontalRule", lines, index, index, normalized));
      index += 1;
      continue;
    }

    const list = parseListLine(line.content);
    if (list) {
      const task = list.checked === undefined ? undefined : makeTask(line, list);
      blocks.push(makeBlock("list", lines, index, index, normalized, task ? { task } : {}));
      index += 1;
      continue;
    }

    if (/^\s*>/u.test(line.content)) {
      let end = index;
      while (end + 1 < lines.length && /^\s*>/u.test(lines[end + 1]!.content)) end += 1;
      const first = lines[index]!.content.replace(/^\s*>\s?/u, "");
      const callout = first.match(/^\[!([\w-]+)\](?:\s+(.*))?$/u);
      blocks.push(
        makeBlock(
          callout ? "callout" : "blockquote",
          lines,
          index,
          end,
          normalized,
          callout
            ? {
                calloutType: callout[1]!.toLowerCase(),
                ...(callout[2]?.trim() ? { calloutTitle: callout[2].trim() } : {}),
              }
            : {},
        ),
      );
      index = end + 1;
      continue;
    }

    if (isTableHeader(lines, index)) {
      let end = index + 1;
      while (end < lines.length && lines[end]!.content.includes("|")) end += 1;
      blocks.push(makeBlock("table", lines, index, end - 1, normalized));
      index = end;
      continue;
    }

    let end = index;
    while (end + 1 < lines.length && isParagraphContinuation(lines[end + 1]!.content)) end += 1;
    blocks.push(makeBlock("paragraph", lines, index, end, normalized));
    index = end + 1;
  }

  const tasks = attachTaskMetadata(
    normalized,
    blocks,
    blocks.flatMap((block) => (block.task ? [block.task] : [])),
  );
  return { source: normalized, blocks, tasks };
}

export function extractTasks(source: string): readonly MarkdownTask[] {
  return parseSyntaxTree(source).tasks;
}

export function toggleTask(source: string, task: MarkdownTask | string, checked: boolean): string {
  let normalized = normalizeMarkdown(source);
  let tree = parseSyntaxTree(normalized);
  let target = resolveTask(tree.tasks, task);
  if (!target) return normalizeMarkdown(source);
  if (!target.metadata?.id) {
    normalized = ensureTaskMetadata(normalized, target);
    tree = parseSyntaxTree(normalized);
    target = tree.tasks.find(
      (item) => item.metadata?.id === stableTaskId(tree.tasks, target!.text),
    );
    if (!target) return normalized;
  }
  return `${normalized.slice(0, target.markerFrom)}${checked ? "x" : " "}${normalized.slice(target.markerTo)}`;
}

export function parseStoneTaskMetadata(source: string): StoneTaskMetadata | null {
  const match = source.match(/<!--\s*stone-task:\s*(\{[\s\S]*?\})\s*-->/u);
  if (!match?.[1]) return null;
  try {
    const value = JSON.parse(match[1]) as unknown;
    return isStoneTaskMetadata(value) ? value : null;
  } catch {
    return null;
  }
}

export function serializeStoneTaskMetadata(metadata: StoneTaskMetadata): string {
  return `<!-- stone-task: ${JSON.stringify(metadata)} -->`;
}

export function ensureTaskMetadata(source: string, task: MarkdownTask): string {
  const normalized = normalizeMarkdown(source);
  if (task.metadata?.id) return normalized;
  const tasks = parseSyntaxTree(normalized).tasks;
  const id = stableTaskId(tasks, task.text);
  const insertion = serializeStoneTaskMetadata({ id });
  return `${normalized.slice(0, task.to)}${insertion}\n${normalized.slice(task.to)}`;
}

export function updateTaskMetadata(
  source: string,
  task: MarkdownTask | string,
  patch: Partial<StoneTaskMetadata>,
): string {
  let normalized = normalizeMarkdown(source);
  let tree = parseSyntaxTree(normalized);
  let target = resolveTask(tree.tasks, task);
  if (!target) return normalized;
  if (!target.metadata?.id) {
    normalized = ensureTaskMetadata(normalized, target);
    tree = parseSyntaxTree(normalized);
    target = tree.tasks.find(
      (item) => item.metadata?.id === stableTaskId(tree.tasks, target!.text),
    );
  }
  if (!target) return normalized;
  const metadata = { ...(target.metadata ?? {}), ...patch };
  const comment = serializeStoneTaskMetadata(metadata);
  if (target.metadataFrom !== undefined && target.metadataTo !== undefined) {
    return `${normalized.slice(0, target.metadataFrom)}${comment}${normalized.slice(target.metadataTo)}`;
  }
  return normalized;
}

export interface TaskProgress {
  completed: number;
  total: number;
  ratio: number;
}

export function calculateTaskProgress(source: string): TaskProgress {
  const tasks = extractTasks(source).filter((task) => !task.canceled);
  const completed = tasks.filter((task) => task.checked).length;
  return {
    completed,
    total: tasks.length,
    ratio: tasks.length === 0 ? 0 : completed / tasks.length,
  };
}

export interface ProjectExportFile {
  path: string;
  content: string;
}

export function serializeProjectExport(files: readonly ProjectExportFile[]): string {
  return normalizeMarkdown(
    files
      .map((file) => `<!-- stone-export-path: ${file.path} -->\n\n${file.content}`)
      .join("\n\n---\n\n"),
  );
}

export function parseProjectExport(source: string): readonly ProjectExportFile[] {
  const normalized = normalizeMarkdown(source);
  const marker = /<!--\s*stone-export-path:\s*([^>]+?)\s*-->\s*\n/gu;
  const matches = [...normalized.matchAll(marker)];
  return matches.map((match, index) => {
    const path = match[1]?.trim();
    if (!path) throw new MarkdownParseError("Project export path is missing.");
    const contentFrom = (match.index ?? 0) + match[0].length;
    const contentTo = matches[index + 1]?.index ?? normalized.length;
    const content = normalized.slice(contentFrom, contentTo).replace(/\n{2,}---\n[\s\S]*$/u, "");
    return { path, content: normalizeMarkdown(content) };
  });
}

export function applyFormatting(source: string, range: TextRange, kind: FormattingKind): string {
  const normalized = normalizeMarkdown(source);
  const selected = normalized.slice(range.from, range.to);
  if (!selected) return normalized;
  const marker = kind === "bold" ? "**" : kind === "italic" ? "_" : kind === "strike" ? "~~" : "`";
  const before = normalized.slice(Math.max(0, range.from - marker.length), range.from);
  const after = normalized.slice(range.to, range.to + marker.length);
  if (before === marker && after === marker) {
    return `${normalized.slice(0, range.from - marker.length)}${selected}${normalized.slice(range.to + marker.length)}`;
  }
  return `${normalized.slice(0, range.from)}${marker}${selected}${marker}${normalized.slice(range.to)}`;
}

export function toggleLinePrefix(source: string, lineFrom: number, prefix: string): string {
  const normalized = normalizeMarkdown(source);
  const lineEnd = normalized.indexOf("\n", lineFrom);
  const end = lineEnd === -1 ? normalized.length : lineEnd;
  const line = normalized.slice(lineFrom, end);
  const marker = prefix.trimEnd();
  const existing = line.match(new RegExp(`^(\\s*)${escapeRegExp(marker)}(?:\\s+|$)`, "u"));
  if (existing) {
    return `${normalized.slice(0, lineFrom)}${line.slice(existing[0].length)}${normalized.slice(end)}`;
  }
  return `${normalized.slice(0, lineFrom)}${prefix}${prefix.endsWith(" ") ? "" : " "}${line}${normalized.slice(end)}`;
}

export function cycleHeading(source: string, lineFrom: number): string {
  const normalized = normalizeMarkdown(source);
  const lineEnd = normalized.indexOf("\n", lineFrom);
  const end = lineEnd === -1 ? normalized.length : lineEnd;
  const line = normalized.slice(lineFrom, end);
  const match = line.match(/^(\s*)(#{1,6})?\s*(.*)$/u);
  if (!match) return normalized;
  const level = match[2] ? (match[2].length % 6) + 1 : 1;
  const next = `${match[1]}${"#".repeat(level)} ${match[3]}`;
  return `${normalized.slice(0, lineFrom)}${next}${normalized.slice(end)}`;
}

export function sanitizeExternalUrl(value: string): string | null {
  const url = value.trim();
  if (!url || unsafeUrlScheme.test(url)) return null;
  if (/^(?:https?:|mailto:)/iu.test(url)) return url;
  return null;
}

export function containsUnsafeRawHtml(source: string): boolean {
  return rawHtml.test(source);
}

export function sanitizeFileName(value: string, fallback = "stone-note"): string {
  const clean = value
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*]/gu, "-")
    .replace(/\s+/gu, " ")
    .replace(/^\.+|\.+$/gu, "")
    .trim();
  return (clean || fallback).slice(0, 120);
}

export function validateImportFile(name: string, bytes: Uint8Array, maxBytes = 500 * 1024): string {
  const extension = name.slice(name.lastIndexOf(".")).toLowerCase();
  if (!supportedImportExtensions.has(extension)) {
    throw new MarkdownParseError("Only .md and .markdown files can be imported.");
  }
  if (bytes.byteLength > maxBytes) {
    throw new MarkdownParseError("This Markdown file is larger than the supported 500 KB limit.");
  }
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (
      [...decoded].some((character) => {
        const code = character.charCodeAt(0);
        return (
          code === 0 ||
          (code >= 1 && code <= 8) ||
          code === 11 ||
          code === 12 ||
          (code >= 14 && code <= 31)
        );
      })
    )
      throw new Error("binary");
    return normalizeMarkdown(decoded);
  } catch {
    throw new MarkdownParseError("The selected file is not valid UTF-8 Markdown.");
  }
}

interface SourceLine {
  content: string;
  from: number;
  end: number;
}

interface FrontmatterRange {
  contentFrom: number;
  contentTo: number;
  bodyFrom: number;
  endLine: number;
}

interface ListLine {
  markerFrom: number;
  markerTo: number;
  checked: boolean | undefined;
  textFrom: number;
  text: string;
}

function findFrontmatterRange(source: string): FrontmatterRange | null {
  if (!source.startsWith("---\n")) return null;
  const lines = getLines(source);
  for (let index = 1; index < lines.length; index += 1) {
    if (/^(?:---|\.\.\.)\s*$/u.test(lines[index]!.content)) {
      return {
        contentFrom: lines[0]!.end,
        contentTo: lines[index]!.from,
        bodyFrom: lines[index]!.end,
        endLine: index,
      };
    }
  }
  return null;
}

function getLines(source: string): SourceLine[] {
  const result: SourceLine[] = [];
  let from = 0;
  while (from < source.length) {
    const newline = source.indexOf("\n", from);
    const end = newline === -1 ? source.length : newline + 1;
    result.push({ content: source.slice(from, newline === -1 ? end : newline), from, end });
    from = end;
  }
  return result;
}

function makeBlock(
  type: MarkdownBlockType,
  lines: readonly SourceLine[],
  lineFrom: number,
  lineTo: number,
  source: string,
  extra: Partial<MarkdownBlock> = {},
  explicitTo?: number,
): MarkdownBlock {
  const startLine = lines[lineFrom];
  const finishLine = lines[lineTo];
  if (!startLine || !finishLine) throw new MarkdownParseError("Markdown block range is invalid.");
  const from = startLine.from;
  const to = explicitTo ?? finishLine.end;
  return {
    type,
    from,
    to,
    lineFrom,
    lineTo,
    text: source.slice(from, to),
    inline: findInlineTokens(source, from, to),
    ...extra,
  };
}

function parseListLine(content: string): ListLine | null {
  const match = content.match(/^(\s*)(?:([-+*])|(\d+[.)]))\s+(?:(\[([ xX])\])\s+)?(.*)$/u);
  if (!match) return null;
  const markerFrom = match[1]!.length;
  const marker = match[2] ?? match[3];
  if (!marker) return null;
  const markerLength = marker.length;
  const checkboxFrom = markerFrom + markerLength + 1;
  const hasCheckbox = Boolean(match[4]);
  return {
    markerFrom: hasCheckbox ? checkboxFrom + 1 : markerFrom,
    markerTo: hasCheckbox ? checkboxFrom + 2 : markerFrom + markerLength,
    checked: hasCheckbox ? match[5]!.toLowerCase() === "x" : undefined,
    textFrom: content.length - match[6]!.length,
    text: match[6]!,
  };
}

function makeTask(line: SourceLine, list: ListLine): MarkdownTask {
  return {
    id: `task:${line.from}:${list.markerFrom}`,
    from: line.from,
    to: line.end,
    markerFrom: line.from + list.markerFrom,
    markerTo: line.from + list.markerTo,
    checked: list.checked === true,
    text: list.text,
    canceled: false,
  };
}

function attachTaskMetadata(
  source: string,
  blocks: readonly MarkdownBlock[],
  tasks: readonly MarkdownTask[],
): MarkdownTask[] {
  const comments = [...source.matchAll(/<!--\s*stone-task:\s*(\{[\s\S]*?\})\s*-->/gu)].flatMap(
    (match) => {
      const from = match.index ?? 0;
      const to = from + match[0].length;
      const metadata = parseStoneTaskMetadata(match[0]);
      return metadata ? [{ from, to, metadata }] : [];
    },
  );
  return tasks.map((task) => {
    const comment = comments.find(
      (candidate) =>
        candidate.from >= task.to &&
        /^\s*$/u.test(source.slice(task.to, candidate.from)) &&
        !blocks.some(
          (block) =>
            block.type === "code" && candidate.from >= block.from && candidate.from < block.to,
        ),
    );
    const metadata = comment?.metadata;
    return {
      ...task,
      id: metadata?.id ?? task.id,
      ...(comment && metadata
        ? { metadata, metadataFrom: comment.from, metadataTo: comment.to }
        : {}),
      canceled: metadata?.canceled === true,
    };
  });
}

function resolveTask(
  tasks: readonly MarkdownTask[],
  task: MarkdownTask | string,
): MarkdownTask | undefined {
  if (typeof task === "string") return tasks.find((item) => item.id === task);
  return (
    tasks.find((item) => item.id === task.id) ??
    tasks.find((item) => item.text === task.text && item.checked === task.checked)
  );
}

function stableTaskId(tasks: readonly MarkdownTask[], text: string): string {
  const occurrence = tasks.filter((item) => item.text === text).length;
  let hash = 2166136261;
  for (const character of `${text}:${occurrence}`) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return `tsk_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function isStoneTaskMetadata(value: unknown): value is StoneTaskMetadata {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.values(record).every(
    (entry) =>
      entry === null ||
      typeof entry === "string" ||
      typeof entry === "boolean" ||
      typeof entry === "number",
  );
}

function isTableHeader(lines: readonly SourceLine[], index: number): boolean {
  const current = lines[index]?.content ?? "";
  const next = lines[index + 1]?.content ?? "";
  return current.includes("|") && /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/u.test(next);
}

function isParagraphContinuation(content: string): boolean {
  return Boolean(content) && !/^\s*(?:#{1,6}\s|[-+*]\s|\d+[.)]\s|>|```|~~~)/u.test(content);
}

function findInlineTokens(source: string, from: number, to: number): MarkdownInlineToken[] {
  const text = source.slice(from, to);
  const tokens: MarkdownInlineToken[] = [];
  const patterns: Array<[MarkdownInlineToken["type"], RegExp]> = [
    ["strong", /\*\*([^*\n]+)\*\*|__([^_\n]+)__/gu],
    ["strike", /~~([^~\n]+)~~/gu],
    ["inlineCode", /`([^`\n]+)`/gu],
    ["emphasis", /(?<!\w)(?:_([^_\n]+)_|\*([^*\n]+)\*)/gu],
    ["link", /\[([^\]\n]+)\]\(([^)\n]+)\)/gu],
  ];
  for (const [type, pattern] of patterns) {
    for (const match of text.matchAll(pattern)) {
      const index = match.index ?? 0;
      const full = match[0];
      const linkFields = type === "link" ? { label: match[1]!, url: match[2]! } : {};
      tokens.push({
        type,
        from: from + index,
        to: from + index + full.length,
        markerFrom: from + index,
        markerTo: from + index + full.length,
        ...linkFields,
      });
    }
  }
  return tokens.sort((left, right) => left.from - right.from || left.to - right.to);
}

function isFrontmatterRecord(value: unknown): value is Record<string, FrontmatterValue> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    isFrontmatterValue(value)
  );
}

function isFrontmatterValue(value: unknown): value is FrontmatterValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return true;
  if (Array.isArray(value)) return value.every(isFrontmatterValue);
  return Object.values(value as Record<string, unknown>).every(isFrontmatterValue);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

export * from "./project-documents.js";
export * from "./drawing-blocks.js";
export * from "./tasks.js";
