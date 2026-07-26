import { describe, expect, it } from "vitest";
import { detectRevisionConflict, retryDelayMs } from "./index.js";

describe("sync integration boundary", () => {
  it("keeps a pending change safe when the remote revision moved", () => {
    const pending = { baseRevision: 4, remoteRevision: 5 };
    expect(detectRevisionConflict(pending)).toBe(true);
    expect(retryDelayMs(3)).toBe(8_000);
  });
});
