import type {
  Project,
  ProjectHealth,
  ProjectPriority,
  ProjectStatus,
  ProjectTask,
  TodayItem,
} from "./entities.js";

export const projectStatuses: readonly ProjectStatus[] = [
  "idea",
  "planning",
  "development",
  "testing",
  "store_process",
  "live",
  "update_needed",
  "maintenance",
  "paused",
  "archived",
];

export const projectPriorities: readonly ProjectPriority[] = ["low", "medium", "high", "critical"];

export const projectStatusLabels: Readonly<Record<ProjectStatus, string>> = {
  idea: "Fikir",
  planning: "Planlama",
  development: "Geliştirme",
  testing: "Test",
  store_process: "Store Süreci",
  live: "Yayında",
  update_needed: "Güncelleme Lazım",
  maintenance: "Bakımda",
  paused: "Beklemede",
  archived: "Arşivlendi",
};

export const projectPriorityLabels: Readonly<Record<ProjectPriority, string>> = {
  low: "Düşük",
  medium: "Orta",
  high: "Yüksek",
  critical: "Kritik",
};

export function canTransitionProjectStatus(from: ProjectStatus, to: ProjectStatus): boolean {
  return projectStatuses.includes(from) && projectStatuses.includes(to);
}

export function isoDate(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) throw new Error("Invalid date.");
  return date.toISOString().slice(0, 10);
}

export function daysUntil(targetDate: string, today: string): number {
  const target = Date.parse(`${targetDate}T00:00:00.000Z`);
  const base = Date.parse(`${today}T00:00:00.000Z`);
  if (!Number.isFinite(target) || !Number.isFinite(base)) throw new Error("Invalid ISO date.");
  return Math.round((target - base) / 86_400_000);
}

export function isOverdue(targetDate: string | null, today: string): boolean {
  return targetDate !== null && daysUntil(targetDate, today) < 0;
}

export function isDueToday(targetDate: string | null, today: string): boolean {
  return targetDate === today;
}

export function isStale(updatedAt: string, today: string, thresholdDays = 14): boolean {
  return daysUntil(isoDate(updatedAt), today) <= -thresholdDays;
}

export interface ProjectHealthSignals {
  openTasks: number;
  openCriticalBlockers: number;
  missingStoreChecklist: boolean;
  lastUpdatedAt: string;
}

export interface ProjectHealthResult {
  health: ProjectHealth;
  reasons: readonly string[];
}

export function calculateProjectHealth(
  project: Pick<Project, "status" | "priority" | "targetDate" | "nextAction" | "updatedAt">,
  signals: ProjectHealthSignals,
  today: string,
): ProjectHealthResult {
  if (project.status === "paused" || project.status === "archived") {
    return { health: "paused", reasons: ["Proje beklemede veya arşivde."] };
  }

  const reasons: string[] = [];
  if (signals.openCriticalBlockers > 0) reasons.push("Açık kritik blocker var.");
  if (project.targetDate && isOverdue(project.targetDate, today) && signals.openTasks > 0) {
    reasons.push("Hedef tarih geçti ve açık görevler bulunuyor.");
  } else if (
    project.targetDate &&
    daysUntil(project.targetDate, today) <= 7 &&
    signals.openTasks > 0
  ) {
    reasons.push("Hedef tarih yaklaşıyor ve açık görevler bulunuyor.");
  }
  if (signals.missingStoreChecklist && project.status === "store_process") {
    reasons.push("Store sürecinde zorunlu checklist eksik.");
  }
  if (project.status === "live" && project.priority === "high" && !project.nextAction) {
    reasons.push("Yayındaki yüksek öncelikli proje için sonraki iş yok.");
  }
  if (isStale(signals.lastUpdatedAt, today) && signals.openTasks > 0) {
    reasons.push("Aktif projeye uzun süredir dokunulmadı.");
  }
  if (reasons.some((reason) => reason.includes("kritik") || reason.includes("geçti"))) {
    return { health: "risk", reasons };
  }
  if (reasons.length > 0) return { health: "attention", reasons };
  return { health: "good", reasons: ["Açık risk sinyali yok."] };
}

const priorityRank: Readonly<Record<ProjectPriority, number>> = {
  low: 4,
  medium: 3,
  high: 2,
  critical: 1,
};

export function buildTodayItems(
  projects: readonly Project[],
  tasks: readonly ProjectTask[],
  today: string,
): readonly TodayItem[] {
  const byId = new Map(projects.map((project) => [project.id, project]));
  const items: TodayItem[] = [];
  for (const task of tasks) {
    if (task.completed || task.canceled || !task.projectId) continue;
    const project = byId.get(task.projectId);
    if (!project || project.status === "archived") continue;
    const overdue = isOverdue(task.dueDate, today);
    const dueToday = isDueToday(task.dueDate, today);
    const rank =
      overdue && (task.priority === "critical" || task.priority === "high")
        ? 1
        : dueToday
          ? 2
          : task.blocked
            ? 3
            : task.priority === "high" || task.priority === "critical"
              ? 4
              : 5;
    items.push({
      id: `task:${task.id}`,
      kind: "task",
      projectId: project.id,
      projectTitle: project.title,
      text: task.text,
      dueDate: task.dueDate,
      priority: task.priority,
      blocked: task.blocked,
      rank,
      taskId: task.id,
    });
  }
  for (const project of projects) {
    if (project.status === "archived" || project.status === "paused") continue;
    if (project.nextAction) {
      items.push({
        id: `next:${project.id}`,
        kind: "next_action",
        projectId: project.id,
        projectTitle: project.title,
        text: project.nextAction,
        dueDate: project.targetDate,
        priority: project.priority,
        blocked: false,
        rank: 5,
        taskId: null,
      });
    }
    if (isStale(project.updatedAt, today)) {
      items.push({
        id: `stale:${project.id}`,
        kind: "project_signal",
        projectId: project.id,
        projectTitle: project.title,
        text: "Aktif projeye uzun süredir dokunulmadı.",
        dueDate: null,
        priority: project.priority,
        blocked: false,
        rank: 6,
        taskId: null,
      });
    }
  }
  return items.sort(
    (left, right) =>
      left.rank - right.rank ||
      priorityRank[left.priority ?? "medium"] - priorityRank[right.priority ?? "medium"] ||
      (left.dueDate ?? "9999-12-31").localeCompare(right.dueDate ?? "9999-12-31") ||
      left.text.localeCompare(right.text),
  );
}
