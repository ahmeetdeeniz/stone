import { describe, expect, it } from "vitest";
import { transitionSaveState, type SaveState } from "./save-state";

describe("desktop save-state feedback", () => {
  it("reports edit, persistence, success and failure transitions honestly", () => {
    let state: SaveState = "saved";
    state = transitionSaveState(state, "edited");
    expect(state).toBe("unsaved");
    state = transitionSaveState(state, "save_started");
    expect(state).toBe("saving");
    state = transitionSaveState(state, "save_failed");
    expect(state).toBe("error");
    state = transitionSaveState(state, "edited");
    expect(state).toBe("unsaved");
    state = transitionSaveState(state, "save_started");
    expect(transitionSaveState(state, "save_succeeded")).toBe("saved");
  });

  it("resets feedback only after a document is actually loaded", () => {
    expect(transitionSaveState("error", "document_loaded")).toBe("saved");
  });
});
