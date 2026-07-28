import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { ServerNotification, ServerRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { authContextFromClaims } from "./auth.js";
import { McpUnauthorizedError, type AuthContext } from "./contracts.js";
import type { StoneMcpService } from "./core.js";

type Extra = RequestHandlerExtra<ServerRequest, ServerNotification>;

const page = {
  limit: z.number().int().min(1).max(100).optional(),
  pageToken: z.string().max(2000).optional(),
};
const write = {
  expectedRevision: z.number().int().min(0),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9._:-]{8,160}$/u),
  confirmation: z
    .object({ confirmed: z.literal(true), reason: z.string().max(500).optional() })
    .optional(),
};
const result = (value: unknown) => ({
  structuredContent: value as Record<string, unknown>,
  content: [{ type: "text" as const, text: "Stone MCP result is available in structuredContent." }],
});

export function createMcpServer(service: StoneMcpService): McpServer {
  const server = new McpServer({ name: "stone-mcp", version: "0.1.0" });
  const readMeta = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;
  const writeMeta = {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
    idempotentHint: true,
  } as const;

  server.registerTool(
    "search_notes",
    {
      title: "Search notes",
      description: "Search the authenticated user's Stone notes with bounded snippets.",
      inputSchema: {
        query: z.string().min(1).max(200),
        projectId: z.string().max(200).optional(),
        ...page,
      },
      annotations: readMeta,
    },
    async (input, extra) => result(await service.searchNotes(context(extra), input)),
  );
  server.registerTool(
    "get_note",
    {
      title: "Get note",
      description: "Read one authenticated user's Stone note.",
      inputSchema: { noteId: z.string().min(1).max(200) },
      annotations: readMeta,
    },
    async (input, extra) => result(await service.getNote(context(extra), input.noteId)),
  );
  server.registerTool(
    "list_projects",
    {
      title: "List projects",
      description: "List the authenticated user's Stone projects using bounded pagination.",
      inputSchema: {
        status: z.string().max(40).optional(),
        tag: z.string().max(80).optional(),
        priority: z.string().max(40).optional(),
        health: z.string().max(40).optional(),
        ...page,
      },
      annotations: readMeta,
    },
    async (input, extra) => result(await service.listProjects(context(extra), input)),
  );
  server.registerTool(
    "get_project",
    {
      title: "Get project",
      description:
        "Read project metadata, versions, related notes and recent decisions for the authenticated user.",
      inputSchema: { projectId: z.string().min(1).max(200) },
      annotations: readMeta,
    },
    async (input, extra) => result(await service.getProject(context(extra), input.projectId)),
  );
  server.registerTool(
    "list_versions",
    {
      title: "List versions",
      description: "List versions for an authenticated user's Stone project.",
      inputSchema: { projectId: z.string().min(1).max(200), ...page },
      annotations: readMeta,
    },
    async (input, extra) =>
      result(await service.listVersions(context(extra), input.projectId, input)),
  );
  server.registerTool(
    "get_today_tasks",
    {
      title: "Get today's tasks",
      description: "Read due and overdue open tasks for the authenticated user on an ISO date.",
      inputSchema: { date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u) },
      annotations: readMeta,
    },
    async (input, extra) => result(await service.getTodayTasks(context(extra), input.date)),
  );
  server.registerTool(
    "list_today_tasks",
    {
      title: "List today's tasks",
      description: "List standalone and Markdown-backed due or overdue tasks for an ISO date.",
      inputSchema: { date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u) },
      annotations: readMeta,
    },
    async (input, extra) => result(await service.getTodayTasks(context(extra), input.date)),
  );
  server.registerTool(
    "list_tasks",
    {
      title: "List tasks",
      description: "List the authenticated user's standalone Stone tasks.",
      inputSchema: {
        state: z.enum(["open", "completed", "cancelled"]).optional(),
        projectId: z.string().max(200).optional(),
        search: z.string().max(200).optional(),
        ...page,
      },
      annotations: readMeta,
    },
    async (input, extra) => result(await service.listTasks(context(extra), input)),
  );
  server.registerTool(
    "get_task",
    {
      title: "Get task",
      description: "Read one authenticated user's standalone Stone task.",
      inputSchema: { taskId: z.string().min(1).max(200) },
      annotations: readMeta,
    },
    async (input, extra) => result(await service.getTask(context(extra), input.taskId)),
  );
  server.registerTool(
    "list_overdue_tasks",
    {
      title: "List overdue tasks",
      description: "List open standalone tasks due before an ISO date.",
      inputSchema: { date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u), ...page },
      annotations: readMeta,
    },
    async (input, extra) =>
      result(await service.listOverdueTasks(context(extra), input.date, input)),
  );
  server.registerTool(
    "list_blockers",
    {
      title: "List blockers",
      description:
        "List bounded open blockers derived from the authenticated user's task metadata.",
      inputSchema: page,
      annotations: readMeta,
    },
    async (input, extra) => result(await service.listBlockers(context(extra), input)),
  );
  server.registerTool(
    "list_release_checklists",
    {
      title: "List release checklists",
      description: "List release checklist tasks for the authenticated user.",
      inputSchema: page,
      annotations: readMeta,
    },
    async (input, extra) => result(await service.listReleaseChecklists(context(extra), input)),
  );

  server.registerTool(
    "create_note",
    {
      title: "Create note",
      description: "Create a Stone note. The operation is revision-safe and idempotent.",
      inputSchema: {
        title: z.string().min(1).max(200),
        markdown: z.string().max(512000).optional(),
        ...write,
      },
      annotations: writeMeta,
    },
    async (input, extra) => result(await service.createNote(context(extra), input)),
  );
  server.registerTool(
    "append_to_note",
    {
      title: "Append to note",
      description:
        "Append bounded Markdown to a Stone note with expectedRevision and idempotencyKey.",
      inputSchema: {
        noteId: z.string().min(1).max(200),
        text: z.string().min(1).max(50000),
        ...write,
      },
      annotations: writeMeta,
    },
    async (input, extra) => result(await service.appendToNote(context(extra), input.noteId, input)),
  );
  server.registerTool(
    "create_markdown_task",
    {
      title: "Create task",
      description:
        "Add one task to a Stone note with optional due date, priority and blocker metadata.",
      inputSchema: {
        noteId: z.string().min(1).max(200),
        text: z.string().min(1).max(500),
        due: z.string().max(20).optional(),
        priority: z.string().max(20).optional(),
        blocked: z.boolean().optional(),
        blocker: z.string().max(500).optional(),
        ...write,
      },
      annotations: writeMeta,
    },
    async (input, extra) => result(await service.createTask(context(extra), input.noteId, input)),
  );
  server.registerTool(
    "complete_markdown_task",
    {
      title: "Complete task",
      description: "Set one Stone task's completion state with revision protection.",
      inputSchema: {
        noteId: z.string().min(1).max(200),
        taskId: z.string().min(1).max(200),
        completed: z.boolean(),
        ...write,
      },
      annotations: writeMeta,
    },
    async (input, extra) =>
      result(await service.completeTask(context(extra), input.noteId, input.taskId, input)),
  );
  server.registerTool(
    "create_task",
    {
      title: "Create standalone task",
      description: "Create a local-first standalone Stone task with validated planning metadata.",
      inputSchema: {
        title: z.string().min(1).max(512),
        description: z.string().max(32000).optional(),
        dueDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/u)
          .optional(),
        dueTime: z
          .string()
          .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u)
          .optional(),
        timezone: z.string().max(100).optional(),
        priority: z.enum(["none", "low", "medium", "high"]).optional(),
        projectId: z.string().max(200).optional(),
        parentTaskId: z.string().max(200).optional(),
        tags: z.array(z.string().min(1).max(64)).max(100).optional(),
        estimatedMinutes: z.number().int().min(1).max(100000).optional(),
        ...write,
      },
      annotations: writeMeta,
    },
    async (input, extra) => result(await service.createStandaloneTask(context(extra), input)),
  );
  server.registerTool(
    "update_task",
    {
      title: "Update task",
      description: "Update bounded planning fields with expected-revision protection.",
      inputSchema: {
        taskId: z.string().min(1).max(200),
        title: z.string().min(1).max(512).optional(),
        description: z.string().max(32000).nullable().optional(),
        dueDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/u)
          .nullable()
          .optional(),
        dueTime: z
          .string()
          .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u)
          .nullable()
          .optional(),
        timezone: z.string().max(100).optional(),
        priority: z.enum(["none", "low", "medium", "high"]).optional(),
        projectId: z.string().max(200).nullable().optional(),
        parentTaskId: z.string().max(200).nullable().optional(),
        tags: z.array(z.string().min(1).max(64)).max(100).optional(),
        estimatedMinutes: z.number().int().min(1).max(100000).nullable().optional(),
        ...write,
      },
      annotations: writeMeta,
    },
    async (input, extra) =>
      result(await service.updateStandaloneTask(context(extra), input.taskId, input)),
  );
  server.registerTool(
    "complete_task",
    {
      title: "Complete task",
      description: "Complete one standalone task with expected-revision protection.",
      inputSchema: { taskId: z.string().min(1).max(200), ...write },
      annotations: writeMeta,
    },
    async (input, extra) =>
      result(
        await service.setStandaloneTaskState(context(extra), input.taskId, input, "completed"),
      ),
  );
  server.registerTool(
    "reopen_task",
    {
      title: "Reopen task",
      description: "Reopen one standalone task with expected-revision protection.",
      inputSchema: { taskId: z.string().min(1).max(200), ...write },
      annotations: writeMeta,
    },
    async (input, extra) =>
      result(await service.setStandaloneTaskState(context(extra), input.taskId, input, "open")),
  );
  server.registerTool(
    "delete_task",
    {
      title: "Delete task",
      description: "Soft-delete one standalone task; the operation remains recoverable.",
      inputSchema: { taskId: z.string().min(1).max(200), ...write },
      annotations: writeMeta,
    },
    async (input, extra) =>
      result(await service.deleteStandaloneTask(context(extra), input.taskId, input)),
  );
  server.registerTool(
    "set_next_action",
    {
      title: "Set next action",
      description: "Set or clear a Stone project's next action.",
      inputSchema: {
        projectId: z.string().min(1).max(200),
        nextAction: z.string().max(500).nullable(),
        ...write,
      },
      annotations: writeMeta,
    },
    async (input, extra) =>
      result(await service.setNextAction(context(extra), input.projectId, input)),
  );
  server.registerTool(
    "update_project_status",
    {
      title: "Update project status",
      description:
        "Change a Stone project status. Explicit confirmation is required and every write is audited.",
      inputSchema: {
        projectId: z.string().min(1).max(200),
        status: z.string().min(1).max(40),
        ...write,
      },
      annotations: writeMeta,
    },
    async (input, extra) =>
      result(await service.updateProjectStatus(context(extra), input.projectId, input)),
  );
  server.registerTool(
    "create_version",
    {
      title: "Create version",
      description: "Create a project version and its canonical Markdown document.",
      inputSchema: {
        projectId: z.string().min(1).max(200),
        version: z.string().min(1).max(100),
        title: z.string().max(200).optional(),
        markdown: z.string().max(512000).optional(),
        ...write,
      },
      annotations: writeMeta,
    },
    async (input, extra) =>
      result(await service.createVersion(context(extra), input.projectId, input)),
  );
  server.registerTool(
    "add_release_item",
    {
      title: "Add release item",
      description: "Append one reversible checklist item to a release checklist.",
      inputSchema: {
        checklistId: z.string().min(1).max(200),
        text: z.string().min(1).max(500),
        ...write,
      },
      annotations: writeMeta,
    },
    async (input, extra) =>
      result(await service.addReleaseItem(context(extra), input.checklistId, input)),
  );
  server.registerTool(
    "add_decision",
    {
      title: "Add decision",
      description: "Append an auditable project decision to the authenticated user's decision log.",
      inputSchema: {
        projectId: z.string().min(1).max(200),
        title: z.string().min(1).max(200),
        decision: z.string().min(1).max(5000),
        reason: z.string().max(2000).optional(),
        ...write,
      },
      annotations: writeMeta,
    },
    async (input, extra) =>
      result(await service.addDecision(context(extra), input.projectId, input)),
  );
  const calendarWindow = {
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
    projectId: z.string().max(200).optional(),
    kind: z.enum(["event", "task_block"]).optional(),
    ...page,
  };
  server.registerTool(
    "list_calendar_events",
    {
      title: "List calendar events",
      description: "List a bounded, timezone-explicit Stone calendar window.",
      inputSchema: calendarWindow,
      annotations: readMeta,
    },
    async (input, extra) => result(await service.listCalendarEvents(context(extra), input)),
  );
  server.registerTool(
    "list_agenda",
    {
      title: "List agenda",
      description: "List events and scheduled task blocks in a bounded date window.",
      inputSchema: calendarWindow,
      annotations: readMeta,
    },
    async (input, extra) => result(await service.listCalendarEvents(context(extra), input)),
  );
  server.registerTool(
    "get_calendar_event",
    {
      title: "Get calendar event",
      description: "Get one owner-scoped Stone calendar record.",
      inputSchema: { id: z.string().min(1).max(200) },
      annotations: readMeta,
    },
    async (input, extra) => result(await service.getCalendarEvent(context(extra), input.id)),
  );
  const calendarCreate = {
    title: z.string().min(1).max(512),
    kind: z.enum(["event", "task_block"]).optional(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
    startAt: z.string().datetime().optional(),
    endAt: z.string().datetime().optional(),
    timezone: z.string().min(1).max(100),
    allDay: z.boolean().optional(),
    taskId: z.string().max(200).optional(),
    projectId: z.string().max(200).optional(),
    description: z.string().max(64000).optional(),
    location: z.string().max(1000).optional(),
    category: z.enum(["neutral", "purple", "blue", "green", "amber", "red"]).optional(),
    ...write,
  };
  server.registerTool(
    "create_calendar_event",
    {
      title: "Create calendar event",
      description: "Create an owner-scoped standalone event with explicit timezone.",
      inputSchema: calendarCreate,
      annotations: writeMeta,
    },
    async (input, extra) => result(await service.createCalendarEvent(context(extra), input)),
  );
  server.registerTool(
    "schedule_task",
    {
      title: "Schedule task",
      description:
        "Create a time block referencing an existing task; does not change its due date.",
      inputSchema: {
        ...calendarCreate,
        kind: z.literal("task_block"),
        taskId: z.string().min(1).max(200),
      },
      annotations: writeMeta,
    },
    async (input, extra) => result(await service.createCalendarEvent(context(extra), input)),
  );
  const calendarUpdate = {
    id: z.string().min(1).max(200),
    title: z.string().min(1).max(512).optional(),
    description: z.string().max(64000).nullable().optional(),
    startDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/u)
      .optional(),
    endDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/u)
      .optional(),
    startAt: z.string().datetime().nullable().optional(),
    endAt: z.string().datetime().nullable().optional(),
    timezone: z.string().min(1).max(100).optional(),
    projectId: z.string().max(200).nullable().optional(),
    ...write,
  };
  server.registerTool(
    "update_calendar_event",
    {
      title: "Update calendar event",
      description: "Update one event with revision and idempotency protection.",
      inputSchema: calendarUpdate,
      annotations: writeMeta,
    },
    async ({ id, ...input }, extra) =>
      result(await service.updateCalendarEvent(context(extra), id, input)),
  );
  server.registerTool(
    "reschedule_task_block",
    {
      title: "Reschedule task block",
      description:
        "Move or resize a scheduled task block without changing task completion or due date.",
      inputSchema: calendarUpdate,
      annotations: writeMeta,
    },
    async ({ id, ...input }, extra) =>
      result(await service.updateCalendarEvent(context(extra), id, input)),
  );
  const calendarDelete = { id: z.string().min(1).max(200), ...write };
  server.registerTool(
    "delete_calendar_event",
    {
      title: "Delete calendar event",
      description: "Soft-delete one calendar event with revision protection.",
      inputSchema: calendarDelete,
      annotations: { ...writeMeta, destructiveHint: true },
    },
    async ({ id, ...input }, extra) =>
      result(await service.deleteCalendarEvent(context(extra), id, input)),
  );
  server.registerTool(
    "unschedule_task_block",
    {
      title: "Unschedule task block",
      description: "Remove a task block without deleting or completing its task.",
      inputSchema: calendarDelete,
      annotations: { ...writeMeta, destructiveHint: true },
    },
    async ({ id, ...input }, extra) =>
      result(await service.deleteCalendarEvent(context(extra), id, input)),
  );
  return server;
}

function context(extra: Extra): AuthContext {
  const authInfo = extra.authInfo;
  const userId = authInfo?.extra?.userId;
  if (!authInfo || typeof userId !== "string")
    throw new McpUnauthorizedError("Authenticated Stone user is required.");
  return authContextFromClaims({
    sub: userId,
    scope: authInfo.scopes.join(" "),
    resource: authInfo.resource?.toString() ?? "",
    client_id: authInfo.clientId,
  });
}
