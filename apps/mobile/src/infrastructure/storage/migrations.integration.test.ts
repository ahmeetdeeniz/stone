import { describe, expect, it } from "vitest";
import { migrations } from "./migrations";

describe("SQLite migration plan", () => {
  it("is ordered, versioned, and creates the local-first tables", () => {
    expect(migrations.map((migration) => migration.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const statements = migrations.flatMap((migration) => migration.statements).join(";");
    expect(statements).toContain("CREATE TABLE IF NOT EXISTS documents");
    expect(statements).toContain("CREATE TABLE IF NOT EXISTS outbox");
    expect(statements).toContain("CREATE TABLE IF NOT EXISTS settings");
    expect(statements).toContain("CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts");
    expect(statements).toContain("CREATE TABLE IF NOT EXISTS document_drafts");
    expect(statements).toContain("ALTER TABLE projects ADD COLUMN slug");
    expect(statements).toContain("CREATE TABLE IF NOT EXISTS project_blockers");
    expect(statements).toContain("CREATE INDEX IF NOT EXISTS tasks_owner_due_idx");
    expect(statements).toContain("CREATE TABLE IF NOT EXISTS sync_state");
    expect(statements).toContain("ALTER TABLE conflicts ADD COLUMN local_payload");
    expect(statements).toContain("CREATE TABLE IF NOT EXISTS tasks");
    expect(statements).toContain("CREATE TABLE IF NOT EXISTS task_occurrences");
    expect(statements).toContain("CREATE TABLE IF NOT EXISTS calendar_items");
    expect(statements).toContain("CREATE TABLE IF NOT EXISTS focus_sessions");
    expect(statements).toContain("CREATE TABLE IF NOT EXISTS focus_goals");
    expect(statements).toContain("CREATE INDEX IF NOT EXISTS focus_owner_range_idx");
    expect(statements).toContain("ALTER TABLE devices ADD COLUMN revision");
    expect(statements).toContain("ALTER TABLE settings ADD COLUMN revision");
    expect(statements).toContain("CREATE TABLE IF NOT EXISTS drawings");
    expect(statements).toContain("CREATE TABLE IF NOT EXISTS drawing_revisions");
  });
});
