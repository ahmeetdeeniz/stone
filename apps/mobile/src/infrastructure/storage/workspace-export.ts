import type { ExportedProjectFile } from "@stone/domain";
import { File } from "expo-file-system";
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

interface ExportDrawingRow {
  id: string;
  source_path: string;
  preview_path: string;
}

interface ExportJsonRow {
  readonly [key: string]: string | number | null;
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
    schema: 2,
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
  const drawings = await database.getAllAsync<ExportDrawingRow>(
    "SELECT id, source_path, preview_path FROM drawings WHERE owner_id = ? AND deleted_at IS NULL ORDER BY id",
    ownerId,
  );
  const assets: ExportedProjectFile[] = [];
  for (const drawing of drawings) {
    const sourceFile = new File(drawing.source_path);
    if (sourceFile.exists)
      assets.push({
        path: `assets/drawings/${drawing.id}.stoneink`,
        content: await sourceFile.text(),
      });
    const previewFile = new File(drawing.preview_path);
    if (previewFile.exists)
      assets.push({
        path: `assets/drawings/${drawing.id}.png`,
        content: await previewFile.base64(),
        encoding: "base64",
        mimeType: "image/png",
      });
  }
  const tasks = await database.getAllAsync<ExportJsonRow>(
    "SELECT id, schema_version, title, description, state, completed_at, due_date, due_time, timezone, priority, sort_order, tags, project_id, source_document_id, source_block_id, parent_task_id, estimated_minutes, recurrence, recurrence_series_id, occurrence_date, revision, created_at, updated_at, deleted_at, updated_by_device_id FROM tasks WHERE owner_id = ? ORDER BY created_at, id",
    ownerId,
  );
  const occurrences = await database.getAllAsync<ExportJsonRow>(
    "SELECT id, task_id, series_id, scheduled_date, completed_at, task_snapshot FROM task_occurrences WHERE owner_id = ? ORDER BY scheduled_date, id",
    ownerId,
  );
  const taskExport: ExportedProjectFile = {
    path: "tasks.json",
    content: JSON.stringify({ schema: 1, tasks, occurrences }, null, 2),
    mimeType: "application/json",
  };
  return [
    ...documents,
    ...assets,
    taskExport,
    {
      path: "manifest.json",
      content: JSON.stringify(
        {
          ...manifest,
          drawings: drawings.map((drawing) => ({
            id: drawing.id,
            source: `assets/drawings/${drawing.id}.stoneink`,
            preview: `assets/drawings/${drawing.id}.png`,
          })),
          tasks: "tasks.json",
        },
        null,
        2,
      ),
    },
  ];
}

function standalonePath(row: ExportDocumentRow): string {
  const title = sanitizeFileName(row.title, "untitled");
  const folder = row.kind === "note" ? "Notes" : "Workspace";
  return `${folder}/${title}-${row.id.slice(0, 8)}.md`;
}
