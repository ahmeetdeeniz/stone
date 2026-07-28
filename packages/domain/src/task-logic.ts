import type {
  Task,
  TaskListOptions,
  TaskPriority,
  TaskRecurrence,
  TaskRecurrenceFrequency,
  TaskRecurrenceUnit,
  TaskState,
} from "./entities.js";
import { ValidationError } from "./errors.js";
import { isValidIsoDate } from "./project-logic.js";

export const taskStates: readonly TaskState[] = ["open", "completed", "cancelled"];
export const taskPriorities: readonly TaskPriority[] = ["none", "low", "medium", "high"];
export const taskRecurrenceFrequencies: readonly TaskRecurrenceFrequency[] = [
  "daily",
  "weekdays",
  "weekly",
  "monthly",
  "custom",
];
export const taskRecurrenceUnits: readonly TaskRecurrenceUnit[] = ["day", "week", "month"];

export function validateTask(task: Task): Task {
  if (task.schemaVersion !== 1) throw new ValidationError("Unsupported task schema version.");
  if (!task.id.trim() || !task.ownerId.trim())
    throw new ValidationError("Task identity is required.");
  if (!task.title.trim()) throw new ValidationError("Task title is required.");
  if (task.title.length > 512) throw new ValidationError("Task title is too long.");
  if (task.description && task.description.length > 32_000)
    throw new ValidationError("Task description is too long.");
  if (!taskStates.includes(task.state)) throw new ValidationError("Task state is invalid.");
  if (!taskPriorities.includes(task.priority))
    throw new ValidationError("Task priority is invalid.");
  if (task.dueDate && !isValidIsoDate(task.dueDate))
    throw new ValidationError("Task due date must be YYYY-MM-DD.");
  if (task.dueTime && !/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(task.dueTime))
    throw new ValidationError("Task due time must be HH:mm.");
  if (!isValidTimeZone(task.timezone)) throw new ValidationError("Task timezone is invalid.");
  if (
    task.estimatedMinutes !== null &&
    (!Number.isInteger(task.estimatedMinutes) ||
      task.estimatedMinutes < 1 ||
      task.estimatedMinutes > 100_000)
  )
    throw new ValidationError("Estimated duration is invalid.");
  if (!Number.isFinite(task.sortOrder)) throw new ValidationError("Task order is invalid.");
  if (task.tags.length > 100 || task.tags.some((tag) => !tag.trim() || tag.length > 64))
    throw new ValidationError("Task tags are invalid.");
  if (task.state === "completed" && !task.completedAt)
    throw new ValidationError("Completed tasks require a completion timestamp.");
  if (task.state !== "completed" && task.completedAt)
    throw new ValidationError("Only completed tasks may have a completion timestamp.");
  if (task.recurrence) validateRecurrence(task.recurrence);
  return {
    ...task,
    title: task.title.trim(),
    tags: [...new Set(task.tags.map((tag) => tag.trim()))],
  };
}

export function validateRecurrence(recurrence: TaskRecurrence): void {
  if (!taskRecurrenceFrequencies.includes(recurrence.frequency))
    throw new ValidationError("Task recurrence frequency is invalid.");
  if (!taskRecurrenceUnits.includes(recurrence.unit))
    throw new ValidationError("Task recurrence unit is invalid.");
  if (
    !Number.isInteger(recurrence.interval) ||
    recurrence.interval < 1 ||
    recurrence.interval > 999
  )
    throw new ValidationError("Task recurrence interval is invalid.");
  if (
    recurrence.preferredDayOfMonth !== null &&
    (!Number.isInteger(recurrence.preferredDayOfMonth) ||
      recurrence.preferredDayOfMonth < 1 ||
      recurrence.preferredDayOfMonth > 31)
  )
    throw new ValidationError("Preferred day of month is invalid.");
}

export function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

export function matchesTaskList(task: Task, options: TaskListOptions = {}): boolean {
  if (!options.includeDeleted && task.deletedAt) return false;
  if (options.state && task.state !== options.state) return false;
  if (options.projectId && task.projectId !== options.projectId) return false;
  if (options.parentTaskId !== undefined && task.parentTaskId !== options.parentTaskId)
    return false;
  if (options.priority && task.priority !== options.priority) return false;
  if (options.tags?.some((tag) => !task.tags.includes(tag))) return false;
  if (options.search) {
    const query = options.search.trim().toLocaleLowerCase();
    const haystack =
      `${task.title}\n${task.description ?? ""}\n${task.tags.join(" ")}`.toLocaleLowerCase();
    if (!haystack.includes(query)) return false;
  }
  if (options.due) {
    if (!options.today || !isValidIsoDate(options.today)) return false;
    if (!task.dueDate || task.state !== "open") return false;
    if (options.due === "today" && task.dueDate !== options.today) return false;
    if (options.due === "overdue" && task.dueDate >= options.today) return false;
    if (options.due === "upcoming" && task.dueDate <= options.today) return false;
  }
  return true;
}

export function compareTasks(left: Task, right: Task): number {
  const due = (left.dueDate ?? "9999-12-31").localeCompare(right.dueDate ?? "9999-12-31");
  if (due !== 0) return due;
  const priority = { high: 0, medium: 1, low: 2, none: 3 } as const;
  return (
    priority[left.priority] - priority[right.priority] ||
    left.sortOrder - right.sortOrder ||
    left.id.localeCompare(right.id)
  );
}
