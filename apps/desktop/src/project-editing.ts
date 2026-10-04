import {
  createProjectDocumentSet,
  createProjectMarkdown,
  updateProjectFrontmatter,
  type ProjectTemplate,
} from "@stone/markdown";
import type { DesktopProject } from "./desktop-api";

export interface ProjectDocumentDraft {
  id: string;
  title: string;
  markdown: string;
  path: string;
  kind: "project" | "inbox" | "decision_log" | "release_checklist";
  projectId: string;
}

export type ProjectChanges = Partial<
  Pick<
    DesktopProject,
    | "title"
    | "status"
    | "priority"
    | "targetDate"
    | "currentVersion"
    | "nextVersion"
    | "nextAction"
    | "repositoryUrl"
    | "tags"
    | "platforms"
  >
>;

/**
 * The same project workspace the mobile app creates: the synced project entity plus its
 * Project.md, Inbox, Decisions and Release Checklist documents. Owner and device fields are
 * filled in by the desktop backend when the records are saved and pushed.
 */
export function createDesktopProject(input: {
  title: string;
  template: ProjectTemplate;
  now: string;
  newId: () => string;
}): { project: DesktopProject; documents: ProjectDocumentDraft[] } {
  const title = input.title.trim();
  const id = input.newId();
  const slug = slugify(title);
  const projectDocumentId = input.newId();
  const companion = createProjectDocumentSet();
  const project: DesktopProject = {
    id,
    ownerId: "",
    canonicalDocumentId: projectDocumentId,
    title,
    slug,
    status: "planning",
    priority: "medium",
    tags: [],
    targetDate: null,
    currentVersion: null,
    nextVersion: null,
    nextAction: null,
    repositoryUrl: null,
    platforms: [],
    health: "good",
    revision: 0,
    createdAt: input.now,
    updatedAt: input.now,
    deletedAt: null,
    updatedByDeviceId: "",
  };
  const document = (
    documentId: string,
    kind: ProjectDocumentDraft["kind"],
    documentTitle: string,
    markdown: string,
    file: string,
  ): ProjectDocumentDraft => ({
    id: documentId,
    title: documentTitle,
    markdown,
    path: `Projects/${slug}/${file}`,
    kind,
    projectId: id,
  });
  return {
    project,
    documents: [
      document(
        projectDocumentId,
        "project",
        title,
        createProjectMarkdown({ id, title, template: input.template }),
        "Project.md",
      ),
      document(input.newId(), "inbox", "Inbox", companion.inbox, "Inbox.md"),
      document(input.newId(), "decision_log", "Decisions", companion.decisions, "Decisions.md"),
      document(
        input.newId(),
        "release_checklist",
        "Release Checklist",
        companion.releaseChecklist,
        "Release-Checklist.md",
      ),
    ],
  };
}

/**
 * Applies an edit to both the project entity and its Project.md, the way the mobile project
 * repository does, so either client shows the same metadata.
 */
export function applyProjectChanges(
  project: DesktopProject,
  markdown: string,
  changes: ProjectChanges,
): { project: DesktopProject; markdown: string } {
  const next: DesktopProject = {
    ...project,
    ...changes,
    title: changes.title?.trim() || project.title,
    tags: changes.tags ?? project.tags,
    platforms: changes.platforms ?? project.platforms,
  };
  let nextMarkdown = updateProjectFrontmatter(markdown, {
    status: next.status,
    priority: next.priority,
    tags: [...next.tags],
    currentVersion: next.currentVersion,
    nextVersion: next.nextVersion,
    targetDate: next.targetDate,
    platforms: [...next.platforms],
    repositoryUrl: next.repositoryUrl,
    nextAction: next.nextAction,
  });
  if (next.title !== project.title) {
    nextMarkdown = nextMarkdown.replace(/^(#\s+).+$/mu, `$1${next.title}`);
  }
  return { project: next, markdown: nextMarkdown };
}

/** Empty strings from form fields mean "not set". */
export function optionalText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/** Synced documents created on mobile carry workspace-relative paths, not files on this disk. */
export function isLinkedFilePath(path: string | null | undefined): path is string {
  return Boolean(
    path && (/^[A-Za-z]:[\\/]/u.test(path) || path.startsWith("\\\\") || path.startsWith("/")),
  );
}

function slugify(value: string): string {
  return (
    value
      .normalize("NFKD")
      .replace(/[̀-ͯ]/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-+|-+$/gu, "")
      .slice(0, 80) || "project"
  );
}
