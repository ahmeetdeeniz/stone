import { describe, expect, it, vi } from "vitest";
import { parseProjectFrontmatter, parseVersionFrontmatter } from "@stone/markdown";

vi.mock("expo-crypto", () => ({
  randomUUID: vi.fn(() => "generated-id"),
}));

import { createNewProjectWorkspace, createNewVersion } from "./factory";

describe("project workspace factory", () => {
  it("keeps creation metadata aligned between the index and Project.md", () => {
    const workspace = createNewProjectWorkspace({
      ownerId: "owner",
      title: "Stone Mobile",
      template: "blank",
      deviceId: "device",
      status: "testing",
      priority: "high",
      tags: ["mobil", "foundation"],
      targetDate: "2026-09-30",
      platforms: ["android", "ios"],
    });
    const frontmatter = parseProjectFrontmatter(workspace.documents[0]!.markdown);

    expect(workspace.project).toMatchObject({
      status: "testing",
      priority: "high",
      tags: ["mobil", "foundation"],
      targetDate: "2026-09-30",
      platforms: ["android", "ios"],
    });
    expect(frontmatter).toMatchObject({
      status: workspace.project.status,
      priority: workspace.project.priority,
      tags: workspace.project.tags,
      targetDate: workspace.project.targetDate,
      platforms: workspace.project.platforms,
      nextAction: workspace.project.nextAction,
    });

    const version = createNewVersion(workspace.project, "1.0.0", "device");
    expect(parseVersionFrontmatter(version.document.markdown)).toMatchObject({
      type: "version",
      id: version.version.id,
      projectId: workspace.project.id,
      version: "1.0.0",
      platforms: { android: "not_planned", ios: "not_planned" },
    });
  });
});
