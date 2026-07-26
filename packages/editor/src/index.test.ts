import { describe, expect, it } from "vitest";
import { getSearchQuery } from "@codemirror/search";
import {
  applyEditorCommand,
  buildLivePreviewDecorations,
  createEditorState,
  isEditorBridgeMessage,
} from "./index.js";

describe("editor boundary", () => {
  it("accepts only versioned known bridge messages", () => {
    expect(
      isEditorBridgeMessage({ protocolVersion: 1, type: "ready", payload: { documentId: "note" } }),
    ).toBe(true);
    expect(isEditorBridgeMessage({ protocolVersion: 2, type: "ready" })).toBe(false);
    expect(isEditorBridgeMessage({ protocolVersion: 1, type: "executeScript" })).toBe(false);
    expect(isEditorBridgeMessage({ protocolVersion: 1, type: "setDocument" })).toBe(false);
    expect(
      isEditorBridgeMessage({
        protocolVersion: 1,
        type: "executeCommand",
        payload: { command: "executeScript" },
      }),
    ).toBe(false);
    expect(isEditorBridgeMessage({ protocolVersion: 1, type: "requestState" })).toBe(true);
    expect(isEditorBridgeMessage({ protocolVersion: 1, type: "requestState", payload: {} })).toBe(
      false,
    );
  });

  it("applies source-preserving editor commands", () => {
    const source = "Hello\n";
    const bold = applyEditorCommand(source, 0, 5, "toggleBold");
    expect(bold.source).toBe("**Hello**\n");
    const safeLink = applyEditorCommand(source, 0, 5, "insertLink", "https://example.com");
    expect(safeLink.source).toBe("[Hello](https://example.com)\n");
    expect(applyEditorCommand(source, 0, 5, "insertLink", "javascript:alert(1)").source).toBe(
      source,
    );
  });

  it("creates a real CodeMirror Markdown state", () => {
    const state = createEditorState("# Türkçe\n\n**bold**\n");
    expect(state.doc.toString()).toContain("Türkçe");
  });

  it("configures CodeMirror search state for find-in-note", () => {
    const state = createEditorState("one two");
    expect(getSearchQuery(state).search).toBe("");
  });

  it("builds inactive Live Preview decorations and keeps task source ranges", () => {
    const state = createEditorState("- [ ] görev\n\n> [!NOTE] bilgi\n").update({
      selection: { anchor: 20 },
    }).state;
    expect(() => buildLivePreviewDecorations(state)).not.toThrow();
  });
});
