import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Firebase Storage drawing boundary", () => {
  it("keeps drawing files owner-scoped and type/size constrained", () => {
    const rules = readFileSync(resolve(process.cwd(), "storage.rules"), "utf8");
    expect(rules).toContain("request.auth.uid == uid");
    expect(rules).toContain("fileName in ['source.stoneink', 'preview.png']");
    expect(rules).toContain("request.resource.contentType == 'application/json'");
    expect(rules).toContain("request.resource.contentType == 'image/png'");
    expect(rules).toContain("request.resource.size <= 10 * 1024 * 1024");
    expect(rules).toContain("allow read, write: if false");
  });
});
