import { randomUUID } from "node:crypto";
import {
  canTransitionProjectStatus,
  deleteCalendarRecurrence,
  editCalendarRecurrence,
  validateCalendarItem,
  type CalendarItem,
  type CalendarOccurrenceChanges,
  type CalendarRecurrenceEditScope,
} from "@stone/domain";
import {
  ensureTaskMetadata,
  extractTasks,
  normalizeMarkdown,
  toggleTask,
  updateTaskMetadata,
  type MarkdownTask,
} from "@stone/markdown";
import {
  McpInputError,
  McpNotFoundError,
  type AuthContext,
  type CalendarRecord,
  type DocumentRecord,
  type ProjectRecord,
  type StoneStore,
  type TaskRecord,
  type VersionRecord,
  type WriteResult,
} from "./contracts.js";
import {
  boundedLimit,
  boundedText as assertText,
  validateExpectedRevision,
  validateIdempotencyKey,
} from "./cursor.js";
import { requireScope } from "./auth.js";

const MAX_MARKDOWN = 512_000;
const MAX_RESULTS = 100;
const MCP_DEVICE_PREFIX = "mcp:";

function validateCalendarRecord(value: CalendarRecord): CalendarRecord {
  validateCalendarItem(value as unknown as CalendarItem);
  return value;
}

function requireRecurrenceScope(
  occurrenceDate: string | undefined,
  scope: CalendarRecurrenceEditScope | undefined,
): CalendarRecurrenceEditScope {
  if (!occurrenceDate || !scope)
    throw new McpInputError("Recurring event writes require occurrenceDate and recurrenceScope.");
  assertIsoDate(occurrenceDate, "occurrenceDate");
  return scope;
}

function definedCalendarChanges(input: CalendarUpdateInput): Partial<CalendarRecord> {
  const changes: Partial<CalendarRecord> = {};
  for (const key of [
    "title",
    "description",
    "startDate",
    "endDate",
    "startAt",
    "endAt",
    "timezone",
    "projectId",
    "location",
    "category",
    "planningNote",
  ] as const) {
    const value = input[key];
    if (value !== undefined) Object.assign(changes, { [key]: value });
  }
  return changes;
}

function definedOccurrenceChanges(input: CalendarUpdateInput): CalendarOccurrenceChanges {
  return {
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.startDate !== undefined ? { startDate: input.startDate } : {}),
    ...(input.endDate !== undefined ? { endDate: input.endDate } : {}),
    ...(input.startAt !== undefined ? { startAt: input.startAt } : {}),
    ...(input.endAt !== undefined ? { endAt: input.endAt } : {}),
    ...(input.location !== undefined ? { location: input.location } : {}),
    ...(input.category !== undefined
      ? { category: input.category as CalendarItem["category"] }
      : {}),
  };
}

export interface ReadOptions {
  limit?: number | undefined;
  pageToken?: string | undefined;
}

export interface SearchNotesInput extends ReadOptions {
  query: string;
  projectId?: string | undefined;
}

export interface WriteOptions {
  expectedRevision: number;
  idempotencyKey: string;
  confirmation?: { confirmed: boolean; reason?: string | undefined } | undefined;
}

export interface TaskCreateInput extends WriteOptions {
  title: string;
  description?: string | undefined;
  dueDate?: string | undefined;
  dueTime?: string | undefined;
  timezone?: string | undefined;
  priority?: TaskRecord["priority"] | undefined;
  projectId?: string | undefined;
  parentTaskId?: string | undefined;
  tags?: readonly string[] | undefined;
  estimatedMinutes?: number | undefined;
}

export interface TaskUpdateInput extends WriteOptions {
  title?: string | undefined;
  description?: string | null | undefined;
  dueDate?: string | null | undefined;
  dueTime?: string | null | undefined;
  timezone?: string | undefined;
  priority?: TaskRecord["priority"] | undefined;
  projectId?: string | null | undefined;
  parentTaskId?: string | null | undefined;
  tags?: string[] | undefined;
  estimatedMinutes?: number | null | undefined;
}

export interface CalendarCreateInput extends WriteOptions {
  title: string;
  kind?: "event" | "task_block" | undefined;
  startDate: string;
  endDate: string;
  startAt?: string | undefined;
  endAt?: string | undefined;
  timezone: string;
  allDay?: boolean | undefined;
  taskId?: string | undefined;
  projectId?: string | undefined;
  description?: string | undefined;
  location?: string | undefined;
  category?: string | undefined;
}

export interface CalendarUpdateInput extends WriteOptions {
  title?: string | undefined;
  description?: string | null | undefined;
  startDate?: string | undefined;
  endDate?: string | undefined;
  startAt?: string | null | undefined;
  endAt?: string | null | undefined;
  timezone?: string | undefined;
  projectId?: string | null | undefined;
  location?: string | null | undefined;
  category?: string | undefined;
  planningNote?: string | null | undefined;
  occurrenceDate?: string | undefined;
  recurrenceScope?: CalendarRecurrenceEditScope | undefined;
}

export interface CalendarDeleteInput extends WriteOptions {
  occurrenceDate?: string | undefined;
  recurrenceScope?: CalendarRecurrenceEditScope | undefined;
}

export interface StoneMcpServiceOptions {
  now?: () => Date;
  idFactory?: () => string;
}

export class StoneMcpService {
  private readonly now: () => Date;
  private readonly idFactory: () => string;

  public constructor(
    private readonly store: StoneStore,
    options: StoneMcpServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? randomUUID;
  }

  public async searchNotes(context: AuthContext, input: SearchNotesInput) {
    requireScope(context, "stone.read.notes");
    const query = boundedText(input.query, 200, "query").toLocaleLowerCase();
    const limit = boundedLimit(input.limit);
    const cursorKey = `search-notes:${query}:${input.projectId ?? ""}`;
    const matches: DocumentRecord[] = [];
    let pageToken = input.pageToken;
    let nextPageToken: string | null = null;
    do {
      const page = await this.store.listDocuments(context.userId, {
        kind: "note",
        projectId: input.projectId,
        cursorKey,
        pageToken,
        // One raw row per cursor step keeps filtered search pagination lossless.
        limit: 1,
      });
      matches.push(
        ...page.items.filter((note) =>
          `${note.title}\n${note.markdown}`.toLocaleLowerCase().includes(query),
        ),
      );
      nextPageToken = page.nextPageToken;
      pageToken = page.nextPageToken ?? undefined;
    } while (matches.length < limit && nextPageToken !== null && matches.length < MAX_RESULTS);
    return {
      items: matches.slice(0, limit).map(noteSummary),
      nextPageToken,
    };
  }

  public async getNote(context: AuthContext, noteId: string) {
    requireScope(context, "stone.read.notes");
    const note = await this.getDocument(context, noteId, "note");
    return { ...noteSummary(note), markdown: boundedText(note.markdown, MAX_MARKDOWN, "markdown") };
  }

  public async listProjects(
    context: AuthContext,
    options: ReadOptions & {
      status?: string | undefined;
      tag?: string | undefined;
      priority?: string | undefined;
      health?: string | undefined;
    } = {},
  ) {
    requireScope(context, "stone.read.projects");
    const page = await this.store.listProjects(context.userId, {
      status: options.status,
      tag: options.tag,
      priority: options.priority,
      health: options.health,
      cursorKey: "projects",
      pageToken: options.pageToken,
      limit: boundedLimit(options.limit),
    });
    return { items: page.items.map(projectSummary), nextPageToken: page.nextPageToken };
  }

  public async getProject(context: AuthContext, projectId: string) {
    requireScope(context, "stone.read.projects");
    const project = await this.getProjectRecord(context, projectId);
    const [versions, notes, decisions] = await Promise.all([
      this.store.listVersions(context.userId, { projectId, limit: 25 }),
      this.store.listDocuments(context.userId, { projectId, limit: 25 }),
      this.store.listDocuments(context.userId, { projectId, kind: "decision_log", limit: 10 }),
    ]);
    return {
      project: projectSummary(project),
      versions: versions.items.map(versionSummary),
      relatedNotes: notes.items
        .filter((item) => item.kind === "note")
        .map(noteSummary)
        .slice(0, 25),
      recentDecisions: decisions.items.map((item) => ({
        id: item.id,
        title: item.title,
        markdown: boundedText(item.markdown, 1200, "decision"),
      })),
    };
  }

  public async listVersions(context: AuthContext, projectId: string, options: ReadOptions = {}) {
    requireScope(context, "stone.read.projects");
    const page = await this.store.listVersions(context.userId, {
      projectId,
      cursorKey: `versions:${projectId}`,
      pageToken: options.pageToken,
      limit: boundedLimit(options.limit),
    });
    return { items: page.items.map(versionSummary), nextPageToken: page.nextPageToken };
  }

  public async getTodayTasks(context: AuthContext, date: string) {
    requireScope(context, "stone.read.tasks");
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) throw new McpInputError("date must be an ISO date.");
    const [tasks, documents] = await Promise.all([
      this.store.listTasks(context.userId, {
        state: "open",
        dueBefore: date,
        limit: MAX_RESULTS,
      }),
      this.store.listDocuments(context.userId, { limit: 100 }),
    ]);
    const markdownItems = documents.items.flatMap((document) =>
      extractTasks(document.markdown)
        .filter(
          (task) =>
            !task.checked &&
            !task.canceled &&
            task.metadata?.due !== undefined &&
            task.metadata.due <= date,
        )
        .map((task) => taskSummary(document, task)),
    );
    return {
      date,
      items: [...tasks.items.map(taskSummaryRecord), ...markdownItems].slice(0, MAX_RESULTS),
      nextPageToken: tasks.nextPageToken,
    };
  }

  public async listTasks(
    context: AuthContext,
    options: ReadOptions & {
      state?: TaskRecord["state"] | undefined;
      projectId?: string | undefined;
      search?: string | undefined;
    } = {},
  ) {
    requireScope(context, "stone.read.tasks");
    const page = await this.store.listTasks(context.userId, {
      state: options.state,
      projectId: options.projectId,
      search: options.search,
      cursorKey: `tasks:${options.state ?? ""}:${options.projectId ?? ""}:${options.search ?? ""}`,
      pageToken: options.pageToken,
      limit: boundedLimit(options.limit),
    });
    return { items: page.items.map(taskSummaryRecord), nextPageToken: page.nextPageToken };
  }

  public async getTask(context: AuthContext, taskId: string) {
    requireScope(context, "stone.read.tasks");
    return taskSummaryRecord(await this.getTaskRecord(context, taskId));
  }

  public async listCalendarEvents(
    context: AuthContext,
    input: ReadOptions & {
      startDate: string;
      endDate: string;
      projectId?: string | undefined;
      kind?: "event" | "task_block" | undefined;
    },
  ) {
    requireScope(context, "stone.read.calendar");
    assertIsoDate(input.startDate, "startDate");
    assertIsoDate(input.endDate, "endDate");
    if (
      input.endDate < input.startDate ||
      Date.parse(`${input.endDate}T00:00:00Z`) - Date.parse(`${input.startDate}T00:00:00Z`) >
        366 * 86_400_000
    )
      throw new McpInputError("Calendar window must be ordered and at most 366 days.");
    return this.store.listCalendar(context.userId, {
      startDate: input.startDate,
      endDate: input.endDate,
      projectId: input.projectId,
      kind: input.kind,
      cursorKey: `calendar:${input.startDate}:${input.endDate}:${input.projectId ?? ""}:${input.kind ?? ""}`,
      pageToken: input.pageToken,
      limit: boundedLimit(input.limit),
    });
  }

  public async getCalendarEvent(context: AuthContext, id: string) {
    requireScope(context, "stone.read.calendar");
    const item = await this.store.getCalendar(context.userId, id);
    if (!item || item.deletedAt) throw new McpNotFoundError("Calendar item not found.");
    return item;
  }

  public async createCalendarEvent(context: AuthContext, input: CalendarCreateInput) {
    requireScope(context, "stone.write.calendar");
    validateExpectedRevision(input.expectedRevision);
    if (input.expectedRevision !== 0)
      throw new McpInputError("Create requires expectedRevision 0.");
    const id = this.idFactory();
    const now = this.now().toISOString();
    const item = validateCalendarRecord({
      id,
      ownerId: context.userId,
      schemaVersion: 1,
      kind: input.kind ?? "event",
      title: input.title,
      description: input.description ?? null,
      allDay: input.allDay ?? false,
      startDate: input.startDate,
      endDate: input.endDate,
      startAt: input.startAt ?? null,
      endAt: input.endAt ?? null,
      timezone: input.timezone,
      location: input.location ?? null,
      category: input.category ?? "purple",
      projectId: input.projectId ?? null,
      sourceDocumentId: null,
      taskId: input.taskId ?? null,
      planningNote: null,
      recurrence: null,
      recurrenceSeriesId: null,
      recurrenceId: null,
      overrides: [],
      externalUid: null,
      cancelledAt: null,
      revision: 1,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      updatedByDeviceId: `${MCP_DEVICE_PREFIX}${context.clientId}`,
    });
    return this.store.writeCalendar({
      ownerId: context.userId,
      calendarId: id,
      expectedRevision: 0,
      idempotencyKey: validateIdempotencyKey(input.idempotencyKey),
      tool: input.kind === "task_block" ? "schedule_task" : "create_calendar_event",
      confirmation: input.confirmation ?? null,
      inputSummary: { title: item.title, startDate: item.startDate, kind: item.kind },
      mutate: () => item,
    });
  }

  public async updateCalendarEvent(context: AuthContext, id: string, input: CalendarUpdateInput) {
    requireScope(context, "stone.write.calendar");
    const current = await this.store.getCalendar(context.userId, id);
    if (!current || current.deletedAt) throw new McpNotFoundError("Calendar item not found.");
    const now = this.now().toISOString();
    if (current.recurrence) {
      const scope = requireRecurrenceScope(input.occurrenceDate, input.recurrenceScope);
      if (
        scope === "occurrence" &&
        (input.description !== undefined ||
          input.location !== undefined ||
          input.category !== undefined ||
          input.timezone !== undefined ||
          input.projectId !== undefined ||
          input.planningNote !== undefined)
      )
        throw new McpInputError(
          "Occurrence-only edits support title and times; use future or series for other fields.",
        );
      const recurrenceMutation = editCalendarRecurrence(
        current as unknown as CalendarItem,
        input.occurrenceDate!,
        scope,
        definedOccurrenceChanges(input),
        this.idFactory(),
      );
      const allChanges = definedCalendarChanges(input);
      const mutation = {
        current:
          scope === "series"
            ? ({ ...recurrenceMutation.current, ...allChanges } as CalendarItem)
            : recurrenceMutation.current,
        future: recurrenceMutation.future
          ? ({ ...recurrenceMutation.future, ...allChanges } as CalendarItem)
          : null,
      };
      const future = mutation.future
        ? validateCalendarRecord({
            ...(mutation.future as unknown as CalendarRecord),
            ownerId: context.userId,
            revision: 1,
            createdAt: now,
            updatedAt: now,
            updatedByDeviceId: `${MCP_DEVICE_PREFIX}${context.clientId}`,
          })
        : null;
      if (future)
        await this.store.writeCalendar({
          ownerId: context.userId,
          calendarId: future.id,
          expectedRevision: 0,
          idempotencyKey: `${validateIdempotencyKey(input.idempotencyKey)}:future`,
          tool: "update_calendar_event",
          confirmation: input.confirmation ?? null,
          inputSummary: { id, occurrenceDate: input.occurrenceDate, scope, branch: "future" },
          mutate: () => future,
        });
      const next = validateCalendarRecord({
        ...(mutation.current as unknown as CalendarRecord),
        revision: current.revision + 1,
        updatedAt: now,
        updatedByDeviceId: `${MCP_DEVICE_PREFIX}${context.clientId}`,
      });
      return this.store.writeCalendar({
        ownerId: context.userId,
        calendarId: id,
        expectedRevision: validateExpectedRevision(input.expectedRevision),
        idempotencyKey: validateIdempotencyKey(input.idempotencyKey),
        tool: "update_calendar_event",
        confirmation: input.confirmation ?? null,
        inputSummary: { id, occurrenceDate: input.occurrenceDate, scope },
        mutate: () => next,
      });
    }
    if (input.occurrenceDate || input.recurrenceScope)
      throw new McpInputError("Recurrence scope is only valid for a recurring event.");
    return this.store.writeCalendar({
      ownerId: context.userId,
      calendarId: id,
      expectedRevision: validateExpectedRevision(input.expectedRevision),
      idempotencyKey: validateIdempotencyKey(input.idempotencyKey),
      tool: current.kind === "task_block" ? "reschedule_task_block" : "update_calendar_event",
      confirmation: input.confirmation ?? null,
      inputSummary: {
        id,
        fields: Object.keys(input).filter(
          (key) => !["idempotencyKey", "confirmation"].includes(key),
        ),
      },
      mutate: (value) =>
        validateCalendarRecord({
          ...value!,
          ...definedCalendarChanges(input),
          revision: value!.revision + 1,
          updatedAt: now,
          updatedByDeviceId: `${MCP_DEVICE_PREFIX}${context.clientId}`,
        }),
    });
  }

  public async deleteCalendarEvent(context: AuthContext, id: string, input: CalendarDeleteInput) {
    requireScope(context, "stone.write.calendar");
    const current = await this.store.getCalendar(context.userId, id);
    if (!current) throw new McpNotFoundError("Calendar item not found.");
    const now = this.now().toISOString();
    if (current.recurrence) {
      const scope = requireRecurrenceScope(input.occurrenceDate, input.recurrenceScope);
      const mutation = deleteCalendarRecurrence(
        current as unknown as CalendarItem,
        input.occurrenceDate!,
        scope,
        now,
        this.idFactory(),
      );
      const future = mutation.future
        ? validateCalendarRecord({
            ...(mutation.future as unknown as CalendarRecord),
            ownerId: context.userId,
            revision: 1,
            createdAt: now,
            updatedAt: now,
            updatedByDeviceId: `${MCP_DEVICE_PREFIX}${context.clientId}`,
          })
        : null;
      if (future)
        await this.store.writeCalendar({
          ownerId: context.userId,
          calendarId: future.id,
          expectedRevision: 0,
          idempotencyKey: `${validateIdempotencyKey(input.idempotencyKey)}:future`,
          tool: "delete_calendar_event",
          confirmation: input.confirmation ?? null,
          inputSummary: { id, occurrenceDate: input.occurrenceDate, scope, branch: "future" },
          mutate: () => future,
        });
      const next = validateCalendarRecord({
        ...(mutation.current as unknown as CalendarRecord),
        revision: current.revision + 1,
        updatedAt: now,
        updatedByDeviceId: `${MCP_DEVICE_PREFIX}${context.clientId}`,
      });
      return this.store.writeCalendar({
        ownerId: context.userId,
        calendarId: id,
        expectedRevision: validateExpectedRevision(input.expectedRevision),
        idempotencyKey: validateIdempotencyKey(input.idempotencyKey),
        tool: "delete_calendar_event",
        confirmation: input.confirmation ?? null,
        inputSummary: { id, occurrenceDate: input.occurrenceDate, scope },
        mutate: () => next,
      });
    }
    if (input.occurrenceDate || input.recurrenceScope)
      throw new McpInputError("Recurrence scope is only valid for a recurring event.");
    return this.store.writeCalendar({
      ownerId: context.userId,
      calendarId: id,
      expectedRevision: validateExpectedRevision(input.expectedRevision),
      idempotencyKey: validateIdempotencyKey(input.idempotencyKey),
      tool: current.kind === "task_block" ? "unschedule_task_block" : "delete_calendar_event",
      confirmation: input.confirmation ?? null,
      inputSummary: { id, kind: current.kind },
      mutate: (value) => ({
        ...value!,
        revision: value!.revision + 1,
        updatedAt: now,
        deletedAt: now,
        cancelledAt: now,
        updatedByDeviceId: `${MCP_DEVICE_PREFIX}${context.clientId}`,
      }),
    });
  }

  public async listOverdueTasks(context: AuthContext, date: string, options: ReadOptions = {}) {
    requireScope(context, "stone.read.tasks");
    assertIsoDate(date, "date");
    const page = await this.store.listTasks(context.userId, {
      state: "open",
      dueBefore: previousDate(date),
      cursorKey: `overdue:${date}`,
      pageToken: options.pageToken,
      limit: boundedLimit(options.limit),
    });
    return { date, items: page.items.map(taskSummaryRecord), nextPageToken: page.nextPageToken };
  }

  public async listBlockers(context: AuthContext, options: ReadOptions = {}) {
    requireScope(context, "stone.read.tasks");
    const documents = await this.store.listDocuments(context.userId, { limit: 100 });
    const items = documents.items.flatMap((document) =>
      extractTasks(document.markdown)
        .filter((task) => !task.checked && !task.canceled && task.metadata?.blocked === true)
        .map((task) => ({
          ...taskSummary(document, task),
          blocker: task.metadata?.blocker ?? null,
        })),
    );
    return { items: items.slice(0, boundedLimit(options.limit)), nextPageToken: null };
  }

  public async listReleaseChecklists(context: AuthContext, options: ReadOptions = {}) {
    requireScope(context, "stone.read.tasks");
    const page = await this.store.listDocuments(context.userId, {
      kind: "release_checklist",
      cursorKey: "release-checklists",
      pageToken: options.pageToken,
      limit: boundedLimit(options.limit),
    });
    return {
      items: page.items.map((document) => ({
        ...noteSummary(document),
        tasks: extractTasks(document.markdown)
          .slice(0, MAX_RESULTS)
          .map((task) => ({
            id: task.id,
            text: boundedText(task.text, 500, "task text"),
            completed: task.checked,
            canceled: task.canceled,
          })),
      })),
      nextPageToken: page.nextPageToken,
    };
  }

  public async createNote(
    context: AuthContext,
    input: WriteOptions & { title: string; markdown?: string | undefined },
  ) {
    requireScope(context, "stone.write.notes");
    validateCreate(input);
    const title = boundedText(input.title, 200, "title");
    const markdown = boundedText(normalizeMarkdown(input.markdown ?? ""), MAX_MARKDOWN, "markdown");
    const id = this.idFactory();
    return this.writeDocument(context, id, input, "create_note", () =>
      makeDocument(context, id, title, markdown, this.now(), this.device(context)),
    );
  }

  public async appendToNote(
    context: AuthContext,
    noteId: string,
    input: WriteOptions & { text: string },
  ) {
    requireScope(context, "stone.write.notes");
    const note = await this.getDocument(context, noteId, "note");
    const text = boundedText(input.text, 50_000, "text");
    validateWrite(input);
    return this.writeDocument(context, noteId, input, "append_to_note", (current) => {
      const next = `${current?.markdown ?? note.markdown}\n\n${text}`;
      return {
        ...note,
        markdown: boundedText(normalizeMarkdown(next), MAX_MARKDOWN, "markdown"),
        revision: note.revision + 1,
        updatedAt: this.now().toISOString(),
        updatedByDeviceId: this.device(context),
      };
    });
  }

  public async createTask(
    context: AuthContext,
    noteId: string,
    input: WriteOptions & {
      text: string;
      due?: string | undefined;
      priority?: string | undefined;
      blocked?: boolean | undefined;
      blocker?: string | undefined;
    },
  ) {
    requireScope(context, "stone.write.tasks");
    const note = await this.getDocument(context, noteId, "note");
    const text = boundedText(input.text, 500, "task text");
    validateWrite(input);
    return this.writeDocument(context, noteId, input, "create_task", () => {
      const appended = normalizeMarkdown(`${note.markdown}\n- [ ] ${text}`);
      const task = extractTasks(appended).at(-1);
      if (!task) throw new McpInputError("Unable to create a task.");
      let markdown = ensureTaskMetadata(appended, task);
      const created = extractTasks(markdown).at(-1);
      if (!created) throw new McpInputError("Unable to identify the created task.");
      const metadata = {
        ...(input.due === undefined ? {} : { due: input.due }),
        ...(input.priority === undefined
          ? {}
          : { priority: input.priority as "low" | "medium" | "high" | "critical" }),
        ...(input.blocked === undefined ? {} : { blocked: input.blocked }),
        blocker: input.blocker ?? null,
      };
      markdown = updateTaskMetadata(markdown, created, metadata);
      return {
        ...note,
        markdown: boundedText(markdown, MAX_MARKDOWN, "markdown"),
        revision: note.revision + 1,
        updatedAt: this.now().toISOString(),
        updatedByDeviceId: this.device(context),
      };
    }).then((result) => ({
      ...result,
      taskId: extractTasks(result.entity.markdown).at(-1)?.id ?? "",
    }));
  }

  public async createStandaloneTask(context: AuthContext, input: TaskCreateInput) {
    requireScope(context, "stone.write.tasks");
    validateCreate(input);
    validateTaskInput(input);
    const id = this.idFactory();
    const now = this.now().toISOString();
    return this.store.writeTask({
      ownerId: context.userId,
      taskId: id,
      expectedRevision: 0,
      idempotencyKey: input.idempotencyKey,
      tool: "create_task",
      confirmation: input.confirmation ?? null,
      inputSummary: { ...safeInput(input), title: input.title, projectId: input.projectId ?? null },
      mutate: () => ({
        id,
        ownerId: context.userId,
        schemaVersion: 1,
        title: boundedText(input.title, 512, "title"),
        description: input.description
          ? boundedText(input.description, 32_000, "description")
          : null,
        state: "open",
        completedAt: null,
        dueDate: input.dueDate ?? null,
        dueTime: input.dueTime ?? null,
        timezone: input.timezone ?? "UTC",
        priority: input.priority ?? "none",
        sortOrder: 0,
        tags: [...new Set(input.tags ?? [])],
        projectId: input.projectId ?? null,
        sourceDocumentId: null,
        sourceBlockId: null,
        parentTaskId: input.parentTaskId ?? null,
        estimatedMinutes: input.estimatedMinutes ?? null,
        recurrence: null,
        recurrenceSeriesId: null,
        occurrenceDate: null,
        revision: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        updatedByDeviceId: this.device(context),
      }),
    });
  }

  public async updateStandaloneTask(context: AuthContext, taskId: string, input: TaskUpdateInput) {
    requireScope(context, "stone.write.tasks");
    const task = await this.getTaskRecord(context, taskId);
    validateWrite(input);
    validateTaskInput({ ...task, ...pickTaskChanges(input) });
    return this.writeTask(context, taskId, input, "update_task", () => ({
      ...task,
      ...pickTaskChanges(input),
      revision: task.revision + 1,
      updatedAt: this.now().toISOString(),
      updatedByDeviceId: this.device(context),
    }));
  }

  public async setStandaloneTaskState(
    context: AuthContext,
    taskId: string,
    input: WriteOptions,
    state: "open" | "completed",
  ) {
    requireScope(context, "stone.write.tasks");
    const task = await this.getTaskRecord(context, taskId);
    validateWrite(input);
    return this.writeTask(
      context,
      taskId,
      input,
      state === "completed" ? "complete_task" : "reopen_task",
      () => ({
        ...task,
        state,
        completedAt: state === "completed" ? this.now().toISOString() : null,
        revision: task.revision + 1,
        updatedAt: this.now().toISOString(),
        updatedByDeviceId: this.device(context),
      }),
    );
  }

  public async deleteStandaloneTask(context: AuthContext, taskId: string, input: WriteOptions) {
    requireScope(context, "stone.write.tasks");
    const task = await this.getTaskRecord(context, taskId);
    validateWrite(input);
    return this.writeTask(context, taskId, input, "delete_task", () => ({
      ...task,
      deletedAt: this.now().toISOString(),
      revision: task.revision + 1,
      updatedAt: this.now().toISOString(),
      updatedByDeviceId: this.device(context),
    }));
  }

  public async completeTask(
    context: AuthContext,
    noteId: string,
    taskId: string,
    input: WriteOptions & { completed: boolean },
  ) {
    requireScope(context, "stone.write.tasks");
    const note = await this.getDocument(context, noteId, "note");
    validateWrite(input);
    const task = extractTasks(note.markdown).find((item) => item.id === taskId);
    if (!task) throw new McpNotFoundError("Task not found.");
    return this.writeDocument(context, noteId, input, "complete_task", () => ({
      ...note,
      markdown: boundedText(
        toggleTask(note.markdown, task, input.completed),
        MAX_MARKDOWN,
        "markdown",
      ),
      revision: note.revision + 1,
      updatedAt: this.now().toISOString(),
      updatedByDeviceId: this.device(context),
    }));
  }

  public async setNextAction(
    context: AuthContext,
    projectId: string,
    input: WriteOptions & { nextAction: string | null },
  ) {
    requireScope(context, "stone.write.projects");
    const project = await this.getProjectRecord(context, projectId);
    validateWrite(input);
    const nextAction =
      input.nextAction === null ? null : boundedText(input.nextAction, 500, "nextAction");
    return this.writeProject(context, projectId, input, "set_next_action", () => ({
      ...project,
      nextAction,
      revision: project.revision + 1,
      updatedAt: this.now().toISOString(),
      updatedByDeviceId: this.device(context),
    }));
  }

  public async updateProjectStatus(
    context: AuthContext,
    projectId: string,
    input: WriteOptions & { status: string },
  ) {
    requireScope(context, "stone.write.projects");
    const project = await this.getProjectRecord(context, projectId);
    validateWrite(input);
    if (!canTransitionProjectStatus(project.status as never, input.status as never))
      throw new McpInputError("Invalid project status transition.");
    if (input.confirmation?.confirmed !== true)
      throw new McpInputError("Project status changes require confirmation.");
    return this.writeProject(context, projectId, input, "update_project_status", () => ({
      ...project,
      status: input.status,
      revision: project.revision + 1,
      updatedAt: this.now().toISOString(),
      updatedByDeviceId: this.device(context),
    }));
  }

  public async createVersion(
    context: AuthContext,
    projectId: string,
    input: WriteOptions & {
      version: string;
      title?: string | undefined;
      markdown?: string | undefined;
    },
  ) {
    requireScope(context, "stone.write.projects");
    await this.getProjectRecord(context, projectId);
    validateCreate(input);
    const id = this.idFactory();
    const documentId = this.idFactory();
    const now = this.now().toISOString();
    const version = await this.store.writeVersion({
      ownerId: context.userId,
      versionId: id,
      expectedRevision: 0,
      idempotencyKey: input.idempotencyKey,
      tool: "create_version",
      confirmation: input.confirmation ?? null,
      inputSummary: { projectId, version: input.version },
      mutate: () => ({
        id,
        ownerId: context.userId,
        projectId,
        canonicalDocumentId: documentId,
        version: boundedText(input.version, 100, "version"),
        status: "development",
        targetDate: null,
        androidStatus: "not_planned",
        iosStatus: "not_planned",
        completedTasks: 0,
        totalTasks: 0,
        revision: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        updatedByDeviceId: this.device(context),
      }),
    });
    await this.store.writeDocument({
      ownerId: context.userId,
      documentId,
      expectedRevision: 0,
      idempotencyKey: `${input.idempotencyKey}:document`,
      tool: "create_version",
      confirmation: input.confirmation ?? null,
      inputSummary: { projectId, versionId: id },
      mutate: () =>
        makeDocument(
          context,
          documentId,
          input.title ?? input.version,
          normalizeMarkdown(input.markdown ?? ""),
          this.now(),
          this.device(context),
          "version",
          projectId,
        ),
    });
    return { ...version, documentId };
  }

  public async addReleaseItem(
    context: AuthContext,
    checklistId: string,
    input: WriteOptions & { text: string },
  ) {
    requireScope(context, "stone.write.tasks");
    const checklist = await this.getDocument(context, checklistId, "release_checklist");
    const text = boundedText(input.text, 500, "release item");
    validateWrite(input);
    return this.writeDocument(context, checklistId, input, "add_release_item", () => ({
      ...checklist,
      markdown: boundedText(
        normalizeMarkdown(`${checklist.markdown}\n- [ ] ${text}`),
        MAX_MARKDOWN,
        "markdown",
      ),
      revision: checklist.revision + 1,
      updatedAt: this.now().toISOString(),
      updatedByDeviceId: this.device(context),
    }));
  }

  public async addDecision(
    context: AuthContext,
    projectId: string,
    input: WriteOptions & { title: string; decision: string; reason?: string | undefined },
  ) {
    requireScope(context, "stone.write.projects");
    await this.getProjectRecord(context, projectId);
    const existing = (
      await this.store.listDocuments(context.userId, { projectId, kind: "decision_log", limit: 1 })
    ).items[0];
    const decision = boundedText(input.decision, 5_000, "decision");
    const title = boundedText(input.title, 200, "title");
    validateWrite(input);
    const id = existing?.id ?? this.idFactory();
    const markdown = `## ${title}\n\n${decision}\n\n${input.reason ? `Reason: ${boundedText(input.reason, 2_000, "reason")}\n` : ""}`;
    return this.writeDocument(context, id, input, "add_decision", (current) => {
      const base =
        current ??
        makeDocument(
          context,
          id,
          "Decision log",
          "",
          this.now(),
          this.device(context),
          "decision_log",
          projectId,
        );
      return {
        ...base,
        markdown: boundedText(
          normalizeMarkdown(`${base.markdown}\n${markdown}`),
          MAX_MARKDOWN,
          "markdown",
        ),
        projectId,
        revision: base.revision + 1,
        updatedAt: this.now().toISOString(),
        updatedByDeviceId: this.device(context),
      };
    });
  }

  private async getDocument(
    context: AuthContext,
    id: string,
    kind?: string,
  ): Promise<DocumentRecord> {
    const document = await this.store.getDocument(context.userId, boundedText(id, 200, "id"));
    if (!document || (kind && document.kind !== kind) || document.deletedAt)
      throw new McpNotFoundError("Document not found.");
    return document;
  }

  private async getProjectRecord(context: AuthContext, id: string): Promise<ProjectRecord> {
    const project = await this.store.getProject(context.userId, boundedText(id, 200, "id"));
    if (!project || project.deletedAt) throw new McpNotFoundError("Project not found.");
    return project;
  }

  private async getTaskRecord(context: AuthContext, id: string): Promise<TaskRecord> {
    const task = await this.store.getTask(context.userId, boundedText(id, 200, "id"));
    if (!task || task.deletedAt) throw new McpNotFoundError("Task not found.");
    return task;
  }

  private writeDocument(
    context: AuthContext,
    id: string,
    input: WriteOptions,
    tool: string,
    mutate: (current: DocumentRecord | null) => DocumentRecord,
  ): Promise<WriteResult<DocumentRecord>> {
    return this.store.writeDocument({
      ownerId: context.userId,
      documentId: id,
      expectedRevision: input.expectedRevision,
      idempotencyKey: input.idempotencyKey,
      tool,
      confirmation: input.confirmation ?? null,
      inputSummary: { ...safeInput(input), userId: context.userId },
      mutate,
    });
  }

  private writeProject(
    context: AuthContext,
    id: string,
    input: WriteOptions,
    tool: string,
    mutate: (current: ProjectRecord | null) => ProjectRecord,
  ): Promise<WriteResult<ProjectRecord>> {
    return this.store.writeProject({
      ownerId: context.userId,
      projectId: id,
      expectedRevision: input.expectedRevision,
      idempotencyKey: input.idempotencyKey,
      tool,
      confirmation: input.confirmation ?? null,
      inputSummary: { ...safeInput(input), userId: context.userId },
      mutate,
    });
  }

  private writeTask(
    context: AuthContext,
    id: string,
    input: WriteOptions,
    tool: string,
    mutate: (current: TaskRecord | null) => TaskRecord,
  ): Promise<WriteResult<TaskRecord>> {
    return this.store.writeTask({
      ownerId: context.userId,
      taskId: id,
      expectedRevision: input.expectedRevision,
      idempotencyKey: input.idempotencyKey,
      tool,
      confirmation: input.confirmation ?? null,
      inputSummary: { ...safeInput(input), userId: context.userId },
      mutate,
    });
  }

  private device(context: AuthContext): string {
    return `${MCP_DEVICE_PREFIX}${context.clientId}`.slice(0, 120);
  }
}

function validateCreate(input: WriteOptions): void {
  validateWrite(input);
  if (input.expectedRevision !== 0)
    throw new McpInputError("New entities require expectedRevision 0.");
}

function validateWrite(input: WriteOptions): void {
  validateExpectedRevision(input.expectedRevision);
  validateIdempotencyKey(input.idempotencyKey);
}

function safeInput(input: WriteOptions): Record<string, unknown> {
  return {
    expectedRevision: input.expectedRevision,
    idempotencyKey: input.idempotencyKey.slice(0, 80),
    confirmation: input.confirmation ?? null,
  };
}

function validateTaskInput(input: {
  title: string;
  dueDate?: string | null | undefined;
  dueTime?: string | null | undefined;
  timezone?: string | undefined;
  priority?: TaskRecord["priority"] | undefined;
  tags?: readonly string[] | undefined;
  estimatedMinutes?: number | null | undefined;
}): void {
  boundedText(input.title, 512, "title");
  if (input.dueDate) assertIsoDate(input.dueDate, "dueDate");
  if (input.dueTime && !/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(input.dueTime))
    throw new McpInputError("dueTime must be HH:mm.");
  if (input.timezone) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: input.timezone }).format(new Date(0));
    } catch {
      throw new McpInputError("timezone must be a valid IANA timezone.");
    }
  }
  if (input.priority && !["none", "low", "medium", "high"].includes(input.priority))
    throw new McpInputError("priority is invalid.");
  if ((input.tags?.length ?? 0) > 100 || input.tags?.some((tag) => !tag.trim() || tag.length > 64))
    throw new McpInputError("tags are invalid.");
  if (
    input.estimatedMinutes !== undefined &&
    input.estimatedMinutes !== null &&
    (!Number.isInteger(input.estimatedMinutes) ||
      input.estimatedMinutes < 1 ||
      input.estimatedMinutes > 100_000)
  )
    throw new McpInputError("estimatedMinutes is invalid.");
}

function assertIsoDate(value: string, name: string): void {
  if (
    !/^\d{4}-\d{2}-\d{2}$/u.test(value) ||
    new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value
  )
    throw new McpInputError(`${name} must be an ISO date.`);
}

function previousDate(value: string): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function pickTaskChanges(input: TaskUpdateInput): Partial<TaskRecord> {
  const result: Partial<TaskRecord> = {};
  for (const key of [
    "title",
    "description",
    "dueDate",
    "dueTime",
    "timezone",
    "priority",
    "projectId",
    "parentTaskId",
    "tags",
    "estimatedMinutes",
  ] as const) {
    if (input[key] !== undefined) Object.assign(result, { [key]: input[key] });
  }
  return result;
}

function boundedText(value: string, maxLength: number, name: string): string {
  return assertText(value, name, maxLength);
}

function makeDocument(
  context: AuthContext,
  id: string,
  title: string,
  markdown: string,
  now: Date,
  device: string,
  kind = "note",
  projectId: string | null = null,
): DocumentRecord {
  const timestamp = now.toISOString();
  return {
    id,
    ownerId: context.userId,
    kind,
    title,
    markdown: normalizeMarkdown(markdown),
    path: null,
    projectId,
    isPinned: false,
    revision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
    updatedByDeviceId: device,
  };
}

function noteSummary(note: DocumentRecord) {
  return {
    id: note.id,
    ownerId: note.ownerId,
    kind: note.kind,
    title: boundedText(note.title, 200, "title"),
    projectId: note.projectId,
    revision: note.revision,
    updatedAt: note.updatedAt,
    deletedAt: note.deletedAt,
  };
}
function projectSummary(project: ProjectRecord) {
  return {
    id: project.id,
    title: project.title,
    slug: project.slug,
    status: project.status,
    priority: project.priority,
    tags: project.tags.slice(0, 25),
    targetDate: project.targetDate,
    currentVersion: project.currentVersion,
    nextVersion: project.nextVersion,
    nextAction: project.nextAction,
    repositoryUrl: project.repositoryUrl,
    platforms: project.platforms.slice(0, 10),
    health: project.health,
    revision: project.revision,
    updatedAt: project.updatedAt,
  };
}
function versionSummary(version: VersionRecord) {
  return {
    id: version.id,
    projectId: version.projectId,
    version: version.version,
    status: version.status,
    targetDate: version.targetDate,
    androidStatus: version.androidStatus,
    iosStatus: version.iosStatus,
    completedTasks: version.completedTasks,
    totalTasks: version.totalTasks,
    revision: version.revision,
    updatedAt: version.updatedAt,
  };
}
function taskSummary(document: DocumentRecord, task: MarkdownTask) {
  return {
    id: task.id,
    documentId: document.id,
    projectId: document.projectId,
    text: boundedText(task.text, 500, "task text"),
    completed: task.checked,
    due: task.metadata?.due ?? null,
    priority: task.metadata?.priority ?? null,
    blocked: task.metadata?.blocked === true,
    blocker: task.metadata?.blocker ?? null,
    canceled: task.canceled,
  };
}

function taskSummaryRecord(task: TaskRecord) {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    state: task.state,
    completedAt: task.completedAt,
    dueDate: task.dueDate,
    dueTime: task.dueTime,
    timezone: task.timezone,
    priority: task.priority,
    tags: task.tags,
    projectId: task.projectId,
    sourceDocumentId: task.sourceDocumentId,
    sourceBlockId: task.sourceBlockId,
    parentTaskId: task.parentTaskId,
    estimatedMinutes: task.estimatedMinutes,
    recurrence: task.recurrence,
    recurrenceSeriesId: task.recurrenceSeriesId,
    occurrenceDate: task.occurrenceDate,
    revision: task.revision,
    updatedAt: task.updatedAt,
  };
}
