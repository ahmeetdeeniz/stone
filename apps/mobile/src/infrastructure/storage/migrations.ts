export interface Migration {
  version: number;
  statements: readonly string[];
}

export const migrations: readonly Migration[] = [
  {
    version: 1,
    statements: [
      "CREATE TABLE IF NOT EXISTS settings (owner_id TEXT PRIMARY KEY NOT NULL, theme TEXT NOT NULL DEFAULT 'system', reduce_motion INTEGER NOT NULL DEFAULT 0, editor_font_size INTEGER NOT NULL DEFAULT 17, trash_retention_days INTEGER NOT NULL DEFAULT 30)",
      "CREATE TABLE IF NOT EXISTS devices (id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL, platform TEXT NOT NULL, name TEXT NOT NULL, app_version TEXT NOT NULL, last_seen_at TEXT NOT NULL)",
      "CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY NOT NULL, email TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
      "CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL, created_at TEXT NOT NULL)",
      "CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, markdown TEXT NOT NULL, path TEXT, project_id TEXT, is_pinned INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT, updated_by_device_id TEXT NOT NULL)",
      "CREATE TABLE IF NOT EXISTS document_revisions (id TEXT PRIMARY KEY NOT NULL, document_id TEXT NOT NULL, revision INTEGER NOT NULL, markdown TEXT NOT NULL, created_at TEXT NOT NULL)",
      "CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL, canonical_document_id TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL, priority TEXT NOT NULL, updated_at TEXT NOT NULL)",
      "CREATE TABLE IF NOT EXISTS versions (id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL, project_id TEXT NOT NULL, canonical_document_id TEXT NOT NULL, version TEXT NOT NULL, status TEXT NOT NULL, updated_at TEXT NOT NULL)",
      "CREATE TABLE IF NOT EXISTS tasks_index (id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL, document_id TEXT NOT NULL, text TEXT NOT NULL, completed INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL)",
      "CREATE TABLE IF NOT EXISTS tags (id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL, name TEXT NOT NULL)",
      "CREATE TABLE IF NOT EXISTS project_tags (project_id TEXT NOT NULL, tag_id TEXT NOT NULL, PRIMARY KEY (project_id, tag_id))",
      "CREATE TABLE IF NOT EXISTS conflicts (id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, base_revision INTEGER NOT NULL, local_revision INTEGER NOT NULL, remote_revision INTEGER NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL)",
      "CREATE TABLE IF NOT EXISTS outbox (id TEXT PRIMARY KEY NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, operation TEXT NOT NULL, base_revision INTEGER NOT NULL, payload_version INTEGER NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL, attempt_count INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT, idempotency_key TEXT NOT NULL UNIQUE)",
      "CREATE TABLE IF NOT EXISTS sync_cursors (collection TEXT PRIMARY KEY NOT NULL, cursor TEXT)",
      "CREATE TABLE IF NOT EXISTS migrations (version INTEGER PRIMARY KEY NOT NULL, applied_at TEXT NOT NULL)",
    ],
  },
];
