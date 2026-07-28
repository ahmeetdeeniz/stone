import { extractTasks, parseProjectFrontmatter, parseVersionFrontmatter } from "@stone/markdown";
import type { DesktopDocument } from "./desktop-api";

export interface DesktopProjectSummary {
  id: string;
  documentId: string;
  title: string;
  status: string;
  priority: string;
  currentVersion: string | null;
  nextVersion: string | null;
  targetDate: string | null;
  nextAction: string | null;
  completedTasks: number;
  totalTasks: number;
  blockers: readonly string[];
  versions: readonly string[];
  updatedAt: string;
}

export interface DesktopTodayItem {
  id: string;
  projectId: string;
  projectTitle: string;
  kind: "blocker" | "target" | "next_action";
  text: string;
  targetDate: string | null;
}

export function buildProjectSummaries(
  documents: readonly DesktopDocument[],
): readonly DesktopProjectSummary[] {
  const versions = new Map<string, string[]>();
  for (const document of documents) {
    try {
      const version = parseVersionFrontmatter(document.markdown);
      const values = versions.get(version.projectId) ?? [];
      values.push(version.version);
      versions.set(version.projectId, values);
    } catch {
      // A normal note is not a version document.
    }
  }

  const projects: DesktopProjectSummary[] = [];
  for (const document of documents) {
    try {
      const project = parseProjectFrontmatter(document.markdown);
      const tasks = extractTasks(document.markdown).filter((task) => !task.canceled);
      projects.push({
        id: project.id,
        documentId: document.id,
        title: document.title,
        status: project.status,
        priority: project.priority,
        currentVersion: project.currentVersion,
        nextVersion: project.nextVersion,
        targetDate: project.targetDate,
        nextAction: project.nextAction,
        completedTasks: tasks.filter((task) => task.checked).length,
        totalTasks: tasks.length,
        blockers: tasks
          .filter((task) => task.metadata?.blocked)
          .map((task) => task.metadata?.blocker || task.text),
        versions: [...(versions.get(project.id) ?? [])].sort(),
        updatedAt: document.updatedAt,
      });
    } catch {
      // A normal note is not a project document.
    }
  }
  return projects.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function buildTodayItems(
  projects: readonly DesktopProjectSummary[],
  now = new Date(),
): readonly DesktopTodayItem[] {
  const upcomingLimit = new Date(now);
  upcomingLimit.setDate(upcomingLimit.getDate() + 14);
  const items: DesktopTodayItem[] = [];

  for (const project of projects) {
    for (const [index, blocker] of project.blockers.entries()) {
      items.push({
        id: `${project.id}:blocker:${index}`,
        projectId: project.documentId,
        projectTitle: project.title,
        kind: "blocker",
        text: blocker,
        targetDate: project.targetDate,
      });
    }
    if (project.targetDate) {
      const target = new Date(`${project.targetDate}T00:00:00`);
      if (!Number.isNaN(target.valueOf()) && target <= upcomingLimit) {
        items.push({
          id: `${project.id}:target`,
          projectId: project.documentId,
          projectTitle: project.title,
          kind: "target",
          text: target < now ? "Hedef tarihi geçti" : "Yaklaşan hedef",
          targetDate: project.targetDate,
        });
      }
    }
    if (project.nextAction) {
      items.push({
        id: `${project.id}:next`,
        projectId: project.documentId,
        projectTitle: project.title,
        kind: "next_action",
        text: project.nextAction,
        targetDate: project.targetDate,
      });
    }
  }

  const rank = { blocker: 0, target: 1, next_action: 2 } as const;
  return items.sort((left, right) => rank[left.kind] - rank[right.kind]);
}
