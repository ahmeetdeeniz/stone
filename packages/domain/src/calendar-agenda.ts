import type {
  CalendarCategory,
  CalendarItem,
  CalendarItemKind,
  Project,
  Task,
  TaskState,
} from "./entities.js";
import { expandCalendarOccurrences } from "./calendar-recurrence.js";
import { instantToZonedWallTime } from "./calendar.js";

export interface CalendarFilterOptions {
  startDate: string;
  endDate: string;
  projectId?: string;
  kind?: CalendarItemKind;
  category?: CalendarCategory;
  taskState?: TaskState;
  search?: string;
}

export type AgendaItemKind = "event" | "task_block" | "task_due" | "project_milestone";

export interface AgendaItem {
  id: string;
  kind: AgendaItemKind;
  date: string;
  sortTime: string | null;
  title: string;
  projectId: string | null;
  taskId: string | null;
  sourceDocumentId: string | null;
  calendarItemId: string | null;
  allDay: boolean;
  completed: boolean;
}

type AgendaTask = Pick<
  Task,
  "id" | "title" | "state" | "dueDate" | "dueTime" | "projectId" | "sourceDocumentId" | "deletedAt"
>;
type AgendaProject = Pick<
  Project,
  "id" | "title" | "targetDate" | "canonicalDocumentId" | "deletedAt"
>;

export function filterCalendarItems(
  items: readonly CalendarItem[],
  options: CalendarFilterOptions,
  taskStates: ReadonlyMap<string, TaskState> = new Map(),
): readonly CalendarItem[] {
  const search = options.search?.trim().toLocaleLowerCase() ?? "";
  return items.filter((item) => {
    if (item.deletedAt || item.endDate < options.startDate || item.startDate > options.endDate)
      return false;
    if (options.projectId && item.projectId !== options.projectId) return false;
    if (options.kind && item.kind !== options.kind) return false;
    if (options.category && item.category !== options.category) return false;
    if (
      options.taskState &&
      (!item.taskId || (taskStates.get(item.taskId) ?? "open") !== options.taskState)
    )
      return false;
    if (
      search &&
      !`${item.title}\n${item.description ?? ""}\n${item.location ?? ""}\n${item.planningNote ?? ""}`
        .toLocaleLowerCase()
        .includes(search)
    )
      return false;
    return true;
  });
}

export function buildAgendaItems(
  calendarItems: readonly CalendarItem[],
  tasks: readonly AgendaTask[],
  projects: readonly AgendaProject[],
  startDate: string,
  endDate: string,
): readonly AgendaItem[] {
  if (endDate < startDate) throw new Error("Agenda window is invalid.");
  const output: AgendaItem[] = [];
  for (const source of calendarItems) {
    if (source.deletedAt) continue;
    for (const occurrence of expandCalendarOccurrences(source, startDate, endDate)) {
      const item = occurrence.item;
      output.push({
        id: `calendar:${occurrence.id}`,
        kind: item.kind,
        date: item.startDate,
        sortTime: item.startAt
          ? instantToZonedWallTime(item.startAt, item.timezone).slice(11, 16)
          : null,
        title: item.title,
        projectId: item.projectId,
        taskId: item.taskId,
        sourceDocumentId: item.sourceDocumentId,
        calendarItemId: item.id,
        allDay: item.allDay,
        completed: item.taskId
          ? tasks.find((task) => task.id === item.taskId)?.state === "completed"
          : false,
      });
    }
  }
  for (const task of tasks) {
    if (
      task.deletedAt ||
      !task.dueDate ||
      task.dueDate < startDate ||
      task.dueDate > endDate ||
      task.state === "cancelled"
    )
      continue;
    output.push({
      id: `task-due:${task.id}:${task.dueDate}`,
      kind: "task_due",
      date: task.dueDate,
      sortTime: task.dueTime,
      title: task.title,
      projectId: task.projectId,
      taskId: task.id,
      sourceDocumentId: task.sourceDocumentId,
      calendarItemId: null,
      allDay: !task.dueTime,
      completed: task.state === "completed",
    });
  }
  for (const project of projects) {
    if (
      project.deletedAt ||
      !project.targetDate ||
      project.targetDate < startDate ||
      project.targetDate > endDate
    )
      continue;
    output.push({
      id: `project-milestone:${project.id}:${project.targetDate}`,
      kind: "project_milestone",
      date: project.targetDate,
      sortTime: null,
      title: project.title,
      projectId: project.id,
      taskId: null,
      sourceDocumentId: project.canonicalDocumentId,
      calendarItemId: null,
      allDay: true,
      completed: false,
    });
  }
  return output.sort(
    (left, right) =>
      left.date.localeCompare(right.date) ||
      Number(left.allDay) - Number(right.allDay) ||
      (left.sortTime ?? "").localeCompare(right.sortTime ?? "") ||
      left.kind.localeCompare(right.kind) ||
      left.id.localeCompare(right.id),
  );
}
