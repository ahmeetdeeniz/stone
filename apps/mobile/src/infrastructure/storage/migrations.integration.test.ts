import { describe, expect, it } from "vitest";
import { migrations } from "./migrations";

describe("SQLite migration plan", () => {
  it("is ordered, versioned, and creates the local-first tables", () => {
    expect(migrations.map((migration) => migration.version)).toEqual([1, 2, 3]);
    const statements = migrations.flatMap((migration) => migration.statements).join(";");
    expect(statements).toContain("CREATE TABLE IF NOT EXISTS documents");
    expect(statements).toContain("CREATE TABLE IF NOT EXISTS outbox");
    expect(statements).toContain("CREATE TABLE IF NOT EXISTS settings");
    expect(statements).toContain("CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts");
    expect(statements).toContain("CREATE TABLE IF NOT EXISTS document_drafts");
    expect(statements).toContain("ALTER TABLE projects ADD COLUMN slug");
    expect(statements).toContain("CREATE TABLE IF NOT EXISTS project_blockers");
    expect(statements).toContain("CREATE INDEX IF NOT EXISTS tasks_owner_due_idx");
  });
});
