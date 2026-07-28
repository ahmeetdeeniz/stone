import { validateTask, type Task, type TaskOccurrence } from "@stone/domain";

export interface TaskExport {
  schema: 1;
  tasks: readonly Task[];
  occurrences: readonly TaskOccurrence[];
}

export function parseTaskExport(source: string, ownerId: string): TaskExport {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error("Task export is not valid JSON.");
  }
  if (
    !isRecord(value) ||
    value.schema !== 1 ||
    !Array.isArray(value.tasks) ||
    !Array.isArray(value.occurrences)
  )
    throw new Error("Task export schema is not supported.");
  const ids = new Set<string>();
  const tasks = value.tasks.map((entry) => {
    if (!isRecord(entry) || entry.ownerId !== ownerId)
      throw new Error("Task export owner does not match.");
    const task = validateTask(entry as unknown as Task);
    if (ids.has(task.id)) throw new Error("Task export contains a duplicate task.");
    ids.add(task.id);
    return task;
  });
  const occurrenceIds = new Set<string>();
  const occurrences = value.occurrences.map((entry) => {
    if (
      !isRecord(entry) ||
      typeof entry.id !== "string" ||
      entry.ownerId !== ownerId ||
      typeof entry.taskId !== "string" ||
      typeof entry.seriesId !== "string" ||
      typeof entry.scheduledDate !== "string" ||
      typeof entry.completedAt !== "string" ||
      !isRecord(entry.taskSnapshot)
    )
      throw new Error("Task export contains an invalid occurrence.");
    if (occurrenceIds.has(entry.id))
      throw new Error("Task export contains a duplicate occurrence.");
    occurrenceIds.add(entry.id);
    return {
      id: entry.id,
      ownerId,
      taskId: entry.taskId,
      seriesId: entry.seriesId,
      scheduledDate: entry.scheduledDate,
      completedAt: entry.completedAt,
      taskSnapshot: validateTask(entry.taskSnapshot as unknown as Task),
    };
  });
  return { schema: 1, tasks, occurrences };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
