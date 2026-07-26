import { describe, expect, it } from "vitest";
import { isEditorBridgeMessage } from "./index.js";

describe("editor boundary", () => {
  it("accepts only versioned known bridge messages", () => {
    expect(isEditorBridgeMessage({ protocolVersion: 1, type: "ready" })).toBe(true);
    expect(isEditorBridgeMessage({ protocolVersion: 2, type: "ready" })).toBe(false);
    expect(isEditorBridgeMessage({ protocolVersion: 1, type: "executeScript" })).toBe(false);
  });
});
