import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const fontsSourcePath = path.join(findWorkspaceRoot(), "apps/mobile/src/design/fonts.ts");
const tabLayoutPath = path.join(findWorkspaceRoot(), "apps/mobile/app/(tabs)/_layout.tsx");

describe("Stone public font and icon imports", () => {
  it("imports only the font and icon modules Stone uses", () => {
    const fontsSource = readFileSync(fontsSourcePath, "utf8");
    const tabLayoutSource = readFileSync(tabLayoutPath, "utf8");

    expect(fontsSource).not.toMatch(/from ["']@expo-google-fonts\/inter["']/);
    expect(fontsSource).toContain('@expo-google-fonts/inter/400Regular"');
    expect(fontsSource).toContain('@expo-google-fonts/inter/700Bold"');
    expect(tabLayoutSource).toContain('@expo/vector-icons/Ionicons"');
    expect(tabLayoutSource).not.toMatch(/from ["']@expo\/vector-icons["']/);
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
