import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const fontPath = path.join(findWorkspaceRoot(), "apps/mobile/assets/fonts/Bongita-Regular.otf");

describe("Stone branding font asset", () => {
  it("keeps the approved OTF source at the documented path", () => {
    const font = readFileSync(fontPath);

    expect(fontPath.endsWith("Bongita-Regular.otf")).toBe(true);
    expect(statSync(fontPath).isFile()).toBe(true);
    expect(font.byteLength).toBeGreaterThan(0);
  });
});

function findWorkspaceRoot(): string {
  let current = process.cwd();
  while (!existsSync(path.join(current, "pnpm-workspace.yaml"))) {
    const parent = path.dirname(current);
    if (parent === current) throw new Error("Workspace root was not found.");
    current = parent;
  }
  return current;
}
