import type { ExportedProjectFile } from "@stone/domain";
import { normalizeMarkdown, sanitizeFileName } from "@stone/markdown";
import type { StoneDatabase } from "./database";

interface ExportDocumentRow {
  id: string;
  kind: string;
  title: string;
  markdown: string;
  path: string | null;
  project_id: string | null;
  revision: number;
  updated_at: string;
}

export async function exportWorkspace(
  database: StoneDatabase,
  ownerId: string,
): Promise<readonly ExportedProjectFile[]> {
  const rows = await database.getAllAsync<ExportDocumentRow>(
    "SELECT id, kind, title, markdown, path, project_id, revision, updated_at FROM documents WHERE owner_id = ? AND deleted_at IS NULL ORDER BY updated_at, id",
    ownerId,
  );
  const documents = rows.map((row) => ({
    path: row.path ?? standalonePath(row),
    content: normalizeMarkdown(row.markdown),
  }));
  const manifest = {
    schema: 1,
    ownerId,
    exportedAt: new Date().toISOString(),
    documents: rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      projectId: row.project_id,
      revision: row.revision,
      updatedAt: row.updated_at,
      path: row.path ?? standalonePath(row),
    })),
  };
  return [...documents, { path: "manifest.json", content: JSON.stringify(manifest, null, 2) }];
}

function standalonePath(row: ExportDocumentRow): string {
  const title = sanitizeFileName(row.title, "untitled");
  const folder = row.kind === "note" ? "Notes" : "Workspace";
  return `${folder}/${title}-${row.id.slice(0, 8)}.md`;
}
