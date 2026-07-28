import { describe, expect, it } from "vitest";
import { parseWorkspaceBundle, serializeWorkspaceBundle } from "./workspace-bundle";

describe("workspace export bundle", () => {
  it("round-trips Markdown, manifest JSON, and binary drawing previews", () => {
    const files = [
      { path: "Notes/ğüşi.md", content: "# Türkçe\n" },
      {
        path: "assets/drawings/a.png",
        content: "iVBORw==",
        encoding: "base64" as const,
        mimeType: "image/png",
      },
      { path: "manifest.json", content: '{"schema":1}' },
    ];
    expect(parseWorkspaceBundle(serializeWorkspaceBundle(files))).toEqual([
      { ...files[0], encoding: "utf8", mimeType: "text/markdown" },
      files[1],
      { ...files[2], encoding: "utf8", mimeType: "text/plain" },
    ]);
  });

  it("writes schema v2 while continuing to import legacy v1 bundles", () => {
    const serialized = serializeWorkspaceBundle([
      { path: "tasks.json", content: '{"schema":1,"tasks":[],"occurrences":[]}' },
    ]);
    expect(JSON.parse(serialized)).toMatchObject({ schema: 2, format: "stone-workspace" });
    expect(
      parseWorkspaceBundle(
        '{"schema":1,"format":"stone-workspace","files":[{"path":"Notes/old.md","content":"# Old","encoding":"utf8","mimeType":"text/markdown"}]}',
      ),
    ).toHaveLength(1);
  });

  it("rejects traversal, duplicate paths, invalid binary content, and unknown schemas", () => {
    expect(() => serializeWorkspaceBundle([{ path: "../secret", content: "" }])).toThrow(
      "unsafe path",
    );
    expect(() =>
      serializeWorkspaceBundle([
        { path: "Notes/a.md", content: "" },
        { path: "Notes/a.md", content: "" },
      ]),
    ).toThrow("duplicate path");
    expect(() =>
      serializeWorkspaceBundle([{ path: "a.png", content: "***", encoding: "base64" }]),
    ).toThrow("invalid base64");
    expect(() =>
      parseWorkspaceBundle('{"schema":3,"format":"stone-workspace","files":[]}'),
    ).toThrow("schema is not supported");
  });
});
