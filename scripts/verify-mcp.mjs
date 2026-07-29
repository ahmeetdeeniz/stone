import { readFile } from "node:fs/promises";

const packageJson = JSON.parse(
  await readFile(new URL("../services/mcp/package.json", import.meta.url), "utf8"),
);
const tools = await readFile(new URL("../services/mcp/src/tools.ts", import.meta.url), "utf8");
const requiredDependencies = ["@modelcontextprotocol/sdk", "firebase-admin", "jose", "zod"];
for (const dependency of requiredDependencies) {
  if (!packageJson.dependencies?.[dependency])
    throw new Error(`MCP dependency missing: ${dependency}`);
}
const requiredTools = [
  "search_notes",
  "get_note",
  "list_projects",
  "get_project",
  "list_versions",
  "get_today_tasks",
  "list_blockers",
  "list_release_checklists",
  "create_note",
  "append_to_note",
  "create_task",
  "complete_task",
  "set_next_action",
  "update_project_status",
  "create_version",
  "add_release_item",
  "add_decision",
  "list_calendar_events",
  "get_calendar_event",
  "create_calendar_event",
  "update_calendar_event",
  "delete_calendar_event",
  "list_agenda",
  "schedule_task",
  "reschedule_task_block",
  "unschedule_task_block",
  "get_active_focus_session",
  "list_focus_sessions",
  "start_focus_session",
  "pause_focus_session",
  "resume_focus_session",
  "complete_focus_session",
  "cancel_focus_session",
  "create_manual_focus_session",
  "update_focus_session",
  "get_productivity_summary",
  "get_focus_goal",
  "set_focus_goal",
];
for (const name of requiredTools)
  if (!tools.includes(`"${name}"`)) throw new Error(`MCP tool missing: ${name}`);
for (const forbidden of ["shell", "exec", "git", "bulk_delete", "admin_delete"])
  if (tools.includes(`registerTool("${forbidden}"`))
    throw new Error(`Forbidden MCP tool exposed: ${forbidden}`);
if (!tools.includes("expectedRevision") || !tools.includes("idempotencyKey"))
  throw new Error("MCP writes must expose revision and idempotency controls.");
console.log(
  `MCP verification passed: ${requiredTools.length} bounded tools, no forbidden tool names.`,
);
