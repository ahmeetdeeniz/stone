import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { assertSupportedMigrationVersion, latestMigrationVersion, migrations } from "./migrations";

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

  it("executes a v1-to-current upgrade without discarding existing rows and is repeatable", () => {
    const database = new DatabaseSync(":memory:");
    applyThrough(database, 1);
    database.exec(`
      INSERT INTO documents (
        id, owner_id, kind, title, markdown, is_pinned, revision, created_at, updated_at,
        updated_by_device_id
      ) VALUES (
        'document-1', 'owner-1', 'note', 'Kept', '# Kept', 0, 1,
        '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 'device-1'
      );
      INSERT INTO projects (
        id, owner_id, canonical_document_id, title, status, priority, updated_at
      ) VALUES (
        'project-1', 'owner-1', 'document-1', 'Kept project', 'planning', 'medium',
        '2026-01-01T00:00:00.000Z'
      );
    `);

    applyThrough(database, latestMigrationVersion);
    applyThrough(database, latestMigrationVersion);

    expect(database.prepare("PRAGMA user_version").get()).toMatchObject({
      user_version: latestMigrationVersion,
    });
    expect(
      database.prepare("SELECT title, markdown FROM documents WHERE id = ?").get("document-1"),
    ).toEqual({ title: "Kept", markdown: "# Kept" });
    expect(
      database.prepare("SELECT slug, revision FROM projects WHERE id = ?").get("project-1"),
    ).toEqual({ slug: "", revision: 1 });
    expect(
      database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'focus_sessions'")
        .get(),
    ).toEqual({ name: "focus_sessions" });
    database.close();
  });

  it("rejects an unknown future schema before repositories can use it", () => {
    expect(() => assertSupportedMigrationVersion(latestMigrationVersion + 1)).toThrow(
      /newer than this Stone build/u,
    );
  });
});

function applyThrough(database: DatabaseSync, targetVersion: number): void {
  const current = Number(
    (database.prepare("PRAGMA user_version").get() as { user_version: number }).user_version,
  );
  assertSupportedMigrationVersion(current);
  for (const migration of migrations) {
    if (migration.version <= current || migration.version > targetVersion) continue;
    database.exec("BEGIN");
    try {
      for (const statement of migration.statements) database.exec(statement);
      database.exec(`PRAGMA user_version = ${migration.version}`);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
}
