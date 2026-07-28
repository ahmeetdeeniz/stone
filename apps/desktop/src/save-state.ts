export type SaveState = "saved" | "unsaved" | "saving" | "error";
export type SaveEvent =
  "document_loaded" | "edited" | "save_started" | "save_succeeded" | "save_failed";

export function transitionSaveState(_current: SaveState, event: SaveEvent): SaveState {
  if (event === "edited") return "unsaved";
  if (event === "save_started") return "saving";
  if (event === "save_failed") return "error";
  return "saved";
}
