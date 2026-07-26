import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const fontPath = path.resolve(process.cwd(), "apps/mobile/assets/fonts/Bongita-Regular.otf");

describe("Stone branding font asset", () => {
  it("keeps the approved OTF source at the documented path", () => {
    const font = readFileSync(fontPath);

    expect(fontPath.endsWith("Bongita-Regular.otf")).toBe(true);
    expect(statSync(fontPath).isFile()).toBe(true);
    expect(font.byteLength).toBeGreaterThan(0);
  });
});
