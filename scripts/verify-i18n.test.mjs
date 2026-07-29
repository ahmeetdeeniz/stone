import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { hardcodedUiStrings, interpolationNames, readResource } from "./verify-i18n.mjs";

const temporaryDirectories = [];

function temporaryFile(name, content) {
  const directory = mkdtempSync(join(tmpdir(), "stone-i18n-"));
  temporaryDirectories.push(directory);
  const path = join(directory, name);
  writeFileSync(path, content, "utf8");
  return path;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("i18n verifier", () => {
  it("detects duplicate resource keys", () => {
    const path = temporaryFile(
      "resource.ts",
      'export const en = { "same": "First", "same": "Second" } as const;',
    );
    expect(readResource(path, "en").duplicates).toEqual(["same"]);
  });

  it("extracts sorted interpolation parameters", () => {
    expect(interpolationNames("{{count}} items for {{name}} and {{count}} total")).toEqual([
      "count",
      "count",
      "name",
    ]);
  });

  it("flags static JSX copy but permits documented brand names", () => {
    const path = temporaryFile(
      "view.tsx",
      "export const View = () => <><span>Stone</span><button>Save changes</button></>;",
    );
    expect(hardcodedUiStrings(path).map((finding) => finding.value)).toEqual(["Save changes"]);
  });

  it("keeps MCP tool names and schemas outside the presentation locale boundary", () => {
    const tools = readFileSync(new URL("../services/mcp/src/tools.ts", import.meta.url), "utf8");
    const names = [...tools.matchAll(/registerTool\(\s*"([^"]+)"/gu)].map((match) => match[1]);
    expect(tools).not.toContain("@stone/i18n");
    expect(names).toEqual([
      "search_notes",
      "get_note",
      "list_projects",
      "get_project",
      "list_versions",
      "get_today_tasks",
      "list_today_tasks",
      "list_tasks",
      "get_task",
      "list_overdue_tasks",
      "list_blockers",
      "list_release_checklists",
      "create_note",
      "append_to_note",
      "create_markdown_task",
      "complete_markdown_task",
      "create_task",
      "update_task",
      "complete_task",
      "reopen_task",
      "delete_task",
      "set_next_action",
      "update_project_status",
      "create_version",
      "add_release_item",
      "add_decision",
      "list_calendar_events",
      "list_agenda",
      "get_calendar_event",
      "create_calendar_event",
      "schedule_task",
      "update_calendar_event",
      "reschedule_task_block",
      "delete_calendar_event",
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
    ]);
  });
});
