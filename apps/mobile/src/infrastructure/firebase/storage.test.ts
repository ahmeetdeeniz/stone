import { describe, expect, it } from "vitest";
import { storagePath } from "./storage-path";

describe("drawing storage paths", () => {
  it("uses immutable revision-specific paths so a conflicting upload cannot overwrite history", () => {
    expect(storagePath("owner", "drawing", 1, "source.stoneink")).toBe(
      "users/owner/drawings/drawing/revisions/1/source.stoneink",
    );
    expect(storagePath("owner", "drawing", 2, "source.stoneink")).not.toBe(
      storagePath("owner", "drawing", 1, "source.stoneink"),
    );
  });

  it("rejects invalid revisions", () => {
    expect(() => storagePath("owner", "drawing", 0, "preview.png")).toThrow(
      "positive safe integer",
    );
    expect(() => storagePath("owner", "drawing", Number.NaN, "preview.png")).toThrow(
      "positive safe integer",
    );
  });
});
