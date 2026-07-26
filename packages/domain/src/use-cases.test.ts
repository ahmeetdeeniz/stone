import { describe, expect, it, vi } from "vitest";
import { SettingsUseCases, type SettingsRepository, type UserSettings } from "./index.js";

describe("settings use cases", () => {
  it("keeps persistence behind the use-case boundary", async () => {
    const settings: UserSettings = {
      ownerId: "owner",
      theme: "system",
      reduceMotion: false,
      editorFontSize: 17,
      trashRetentionDays: 30,
    };
    const save = vi.fn(() => Promise.resolve());
    const repository: SettingsRepository = {
      get: vi.fn(() => Promise.resolve(settings)),
      save,
    };
    const useCases = new SettingsUseCases(repository);

    await expect(useCases.setTheme("owner", "dark")).resolves.toMatchObject({ theme: "dark" });
    expect(save).toHaveBeenCalledWith({ ...settings, theme: "dark" });
  });
});
