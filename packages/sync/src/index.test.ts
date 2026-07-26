import { describe, expect, it } from "vitest";
import { detectRevisionConflict, retryDelayMs } from "./index.js";

describe("sync boundary", () => {
  it("detects revision mismatches instead of applying last-write-wins", () => {
    expect(detectRevisionConflict({ baseRevision: 2, remoteRevision: 3 })).toBe(true);
    expect(detectRevisionConflict({ baseRevision: 2, remoteRevision: 2 })).toBe(false);
  });

  it("caps exponential retry delay", () => {
    expect(retryDelayMs(0)).toBe(1_000);
    expect(retryDelayMs(10)).toBe(60_000);
  });
});
