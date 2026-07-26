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
