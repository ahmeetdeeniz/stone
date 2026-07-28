import type { ExportedProjectFile } from "@stone/domain";

interface WorkspaceBundle {
  schema: 1;
  format: "stone-workspace";
  files: readonly WorkspaceBundleFile[];
}

interface WorkspaceBundleFile {
  path: string;
  content: string;
  encoding: "utf8" | "base64";
  mimeType: string;
}

export function serializeWorkspaceBundle(files: readonly ExportedProjectFile[]): string {
  const seen = new Set<string>();
  const normalized = files.map((file) => {
    const path = validateRelativePath(file.path);
    if (seen.has(path)) throw new Error(`Workspace export contains a duplicate path: ${path}`);
    seen.add(path);
    const encoding = file.encoding ?? "utf8";
    if (encoding === "base64" && !isBase64(file.content)) {
      throw new Error(`Workspace export contains invalid base64 data: ${path}`);
    }
    return {
      path,
      content: file.content,
      encoding,
      mimeType: file.mimeType ?? (path.endsWith(".md") ? "text/markdown" : "text/plain"),
    };
  });
  const bundle: WorkspaceBundle = { schema: 1, format: "stone-workspace", files: normalized };
  return `${JSON.stringify(bundle, null, 2)}\n`;
}

export function parseWorkspaceBundle(source: string): readonly ExportedProjectFile[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error("Workspace export is not valid JSON.");
  }
  if (!isRecord(parsed) || parsed.schema !== 1 || parsed.format !== "stone-workspace") {
    throw new Error("Workspace export schema is not supported.");
  }
  if (!Array.isArray(parsed.files)) throw new Error("Workspace export files are missing.");
  const seen = new Set<string>();
  return parsed.files.map((value) => {
    if (
      !isRecord(value) ||
      typeof value.path !== "string" ||
      typeof value.content !== "string" ||
      (value.encoding !== "utf8" && value.encoding !== "base64") ||
      typeof value.mimeType !== "string"
    ) {
      throw new Error("Workspace export contains an invalid file entry.");
    }
    const path = validateRelativePath(value.path);
    if (seen.has(path)) throw new Error(`Workspace export contains a duplicate path: ${path}`);
    seen.add(path);
    if (value.encoding === "base64" && !isBase64(value.content)) {
      throw new Error(`Workspace export contains invalid base64 data: ${path}`);
    }
    return {
      path,
      content: value.content,
      encoding: value.encoding,
      mimeType: value.mimeType,
    };
  });
}

function validateRelativePath(value: string): string {
  const path = value.replaceAll("\\", "/").trim();
  if (
    !path ||
    path.startsWith("/") ||
    /^[A-Za-z]:/u.test(path) ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error(`Workspace export contains an unsafe path: ${value}`);
  }
  return path;
}

function isBase64(value: string): boolean {
  return (
    value.length % 4 === 0 &&
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
