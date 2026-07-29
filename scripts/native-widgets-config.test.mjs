import { describe, expect, it } from "vitest";
import plugin from "../packages/native-widgets/app.plugin.js";

describe("Stone native widget config", () => {
  it("derives deterministic self-host identifiers without a Team ID", () => {
    expect(plugin.identifiers({ ios: { bundleIdentifier: "dev.example.stone" } })).toEqual({
      hostBundleIdentifier: "dev.example.stone",
      extensionBundleIdentifier: "dev.example.stone.widgets",
      appGroupIdentifier: "group.dev.example.stone.widgets",
    });
  });

  it("accepts an explicit App Group and rejects missing host configuration", () => {
    expect(
      plugin.identifiers(
        { ios: { bundleIdentifier: "dev.example.stone" } },
        { appGroupIdentifier: "group.dev.example.shared" },
      ).appGroupIdentifier,
    ).toBe("group.dev.example.shared");
    expect(() => plugin.identifiers({})).toThrow("ios.bundleIdentifier");
  });
});
