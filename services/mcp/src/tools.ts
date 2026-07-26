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
    "create_task",
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
    "complete_task",
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
