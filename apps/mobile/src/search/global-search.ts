import type { CalendarItem, Document, Project, Task } from "@stone/domain";

export interface GlobalSearchSources {
  searchNotes(query: string): Promise<readonly Document[]>;
  searchTasks(query: string): Promise<readonly Task[]>;
  listProjects(): Promise<readonly Project[]>;
  listCalendar(): Promise<readonly CalendarItem[]>;
}

export type GlobalSearchHit =
  | { kind: "note"; id: string; title: string; detail: string | null }
  | { kind: "task"; id: string; title: string; detail: string | null }
  | { kind: "project"; id: string; title: string; detail: string | null }
  | { kind: "event"; id: string; title: string; detail: string | null };

export interface GlobalSearchResult {
  notes: readonly GlobalSearchHit[];
  tasks: readonly GlobalSearchHit[];
  projects: readonly GlobalSearchHit[];
  events: readonly GlobalSearchHit[];
}

export const EMPTY_SEARCH_RESULT: GlobalSearchResult = {
  notes: [],
  tasks: [],
  projects: [],
  events: [],
};

const PER_SECTION = 20;

/**
 * Searches notes (full-text index), tasks, projects and calendar items for one query. Each source
 * is queried independently so one failing store does not hide results from the others.
 */
export async function runGlobalSearch(
  sources: GlobalSearchSources,
  query: string,
): Promise<GlobalSearchResult> {
  const needle = fold(query);
  if (needle.length < 2) return EMPTY_SEARCH_RESULT;
  const [notes, tasks, projects, events] = await Promise.all([
    sources.searchNotes(query.trim()).catch(() => []),
    sources.searchTasks(query.trim()).catch(() => []),
    sources.listProjects().catch(() => []),
    sources.listCalendar().catch(() => []),
  ]);
  return {
    notes: notes.slice(0, PER_SECTION).map((note) => ({
      kind: "note",
      id: note.id,
      title: note.title,
      detail: snippet(note.markdown, needle),
    })),
    tasks: tasks.slice(0, PER_SECTION).map((task) => ({
      kind: "task",
      id: task.id,
      title: task.title,
      detail: task.dueDate ? `${task.dueDate}${task.dueTime ? ` ${task.dueTime}` : ""}` : null,
    })),
    projects: projects
      .filter(
        (project) =>
          !project.deletedAt &&
          [project.title, project.slug, project.nextAction ?? "", ...project.tags].some((value) =>
            fold(value).includes(needle),
          ),
      )
      .slice(0, PER_SECTION)
      .map((project) => ({
        kind: "project",
        id: project.id,
        title: project.title,
        detail: project.nextAction,
      })),
    events: events
      .filter(
        (item) =>
          !item.deletedAt &&
          [item.title, item.description ?? "", item.location ?? ""].some((value) =>
            fold(value).includes(needle),
          ),
      )
      .sort((left, right) => right.startDate.localeCompare(left.startDate))
      .slice(0, PER_SECTION)
      .map((item) => ({
        kind: "event",
        id: item.id,
        title: item.title,
        detail: item.location ? `${item.startDate} · ${item.location}` : item.startDate,
      })),
  };
}

/** A short excerpt around the first match, with Markdown syntax noise removed. */
export function snippet(markdown: string, needle: string, radius = 40): string | null {
  const plain = markdown
    .replace(/^---[\s\S]*?\n---\n/u, "")
    .replace(/[#>*_`~[\]()|-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  const index = fold(plain).indexOf(needle);
  if (index < 0) return plain.slice(0, radius * 2) || null;
  const start = Math.max(0, index - radius);
  const end = Math.min(plain.length, index + needle.length + radius);
  return `${start > 0 ? "…" : ""}${plain.slice(start, end)}${end < plain.length ? "…" : ""}`;
}

function fold(value: string): string {
  return value.normalize("NFC").toLocaleLowerCase("tr").trim();
}
