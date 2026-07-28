export interface MarkdownTaskItem {
  blockId: string | null;
  checked: boolean;
  text: string;
  line: number;
  from: number;
  to: number;
  checkboxFrom: number;
  checkboxTo: number;
  indentation: number;
  fingerprint: string;
}

const TASK_LINE = /^(\s*)(?:[-+*]|\d+[.)])\s+\[([ xX])\]\s+(.*)$/u;
const BLOCK_ID = /(?:^|\s)\^(stone-task-[a-z0-9][a-z0-9-]{2,63})\s*$/iu;

export function extractMarkdownTasks(markdown: string): readonly MarkdownTaskItem[] {
  const tasks: MarkdownTaskItem[] = [];
  const lines = markdown.split("\n");
  let offset = 0;
  let fence: { marker: "`" | "~"; size: number } | null = null;
  const textOccurrences = new Map<string, number>();

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const fenceMatch = /^\s*(`{3,}|~{3,})/u.exec(line);
    if (fenceMatch) {
      const run = fenceMatch[1]!;
      const marker = run[0] as "`" | "~";
      if (!fence) fence = { marker, size: run.length };
      else if (fence.marker === marker && run.length >= fence.size) fence = null;
      offset += line.length + (index < lines.length - 1 ? 1 : 0);
      continue;
    }
    if (!fence) {
      const match = TASK_LINE.exec(line);
      if (match) {
        const rawText = match[3]!;
        const idMatch = BLOCK_ID.exec(rawText);
        const text = (idMatch ? rawText.slice(0, idMatch.index) : rawText).trimEnd();
        const identityText = text.trim().toLocaleLowerCase();
        const occurrence = (textOccurrences.get(identityText) ?? 0) + 1;
        textOccurrences.set(identityText, occurrence);
        const checkboxIndex = line.indexOf("[");
        tasks.push({
          blockId: idMatch?.[1]?.toLowerCase() ?? null,
          checked: match[2]!.toLowerCase() === "x",
          text,
          line: index + 1,
          from: offset,
          to: offset + line.length,
          checkboxFrom: offset + checkboxIndex,
          checkboxTo: offset + checkboxIndex + 3,
          indentation: match[1]!.length,
          fingerprint: taskFingerprint(text, match[1]!.length, occurrence),
        });
      }
    }
    offset += line.length + (index < lines.length - 1 ? 1 : 0);
  }
  return tasks;
}

export function setMarkdownTaskChecked(
  markdown: string,
  task: Pick<MarkdownTaskItem, "checkboxFrom" | "checkboxTo">,
  checked: boolean,
): string {
  const current = markdown.slice(task.checkboxFrom, task.checkboxTo);
  if (!/^\[[ xX]\]$/u.test(current)) throw new Error("Markdown task source changed.");
  return `${markdown.slice(0, task.checkboxFrom)}[${checked ? "x" : " "}]${markdown.slice(task.checkboxTo)}`;
}

export function materializeTaskBlockId(
  markdown: string,
  task: MarkdownTaskItem,
  blockId: string,
): string {
  if (task.blockId) return markdown;
  if (!/^stone-task-[a-z0-9][a-z0-9-]{2,63}$/u.test(blockId))
    throw new Error("Invalid Stone task block identifier.");
  return `${markdown.slice(0, task.to)} ^${blockId}${markdown.slice(task.to)}`;
}

function taskFingerprint(text: string, indentation: number, occurrence: number): string {
  return fnv1a(
    `${text.trim().replace(/\s+/gu, " ").toLocaleLowerCase()}\n${indentation}\n${occurrence}`,
  );
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}
