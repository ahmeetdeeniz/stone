import { describe, expect, it, vi } from "vitest";
import {
  NoteUseCases,
  SettingsUseCases,
  type Document,
  type NoteRepository,
  type SettingsRepository,
  type UserSettings,
} from "./index.js";

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

describe("note use cases", () => {
  it("validates note titles and delegates durable operations", async () => {
    const document: Document = {
      id: "note-1",
      ownerId: "owner",
      kind: "note",
      title: "  Daily note  ",
      markdown: "# Hello\n",
      path: null,
      projectId: null,
      isPinned: false,
      revision: 1,
      createdAt: "2026-07-26T00:00:00.000Z",
      updatedAt: "2026-07-26T00:00:00.000Z",
      deletedAt: null,
      updatedByDeviceId: "device",
    };
    const create = vi.fn(() => Promise.resolve({ ...document, title: "Daily note" }));
    const updateMarkdown = vi.fn(() => Promise.resolve(document));
    const repository: NoteRepository = {
      create,
      getById: vi.fn(() => Promise.resolve(document)),
      list: vi.fn(() => Promise.resolve([document])),
      updateMarkdown,
      rename: vi.fn(() => Promise.resolve(document)),
      setPinned: vi.fn(() => Promise.resolve(document)),
      softDelete: vi.fn(() => Promise.resolve(document)),
      restore: vi.fn(() => Promise.resolve(document)),
      permanentlyDelete: vi.fn(() => Promise.resolve()),
      revisions: vi.fn(() => Promise.resolve([])),
      restoreRevision: vi.fn(() => Promise.resolve(document)),
      getDraft: vi.fn(() => Promise.resolve(null)),
      saveDraft: vi.fn(() => Promise.resolve()),
      clearDraft: vi.fn(() => Promise.resolve()),
    };
    const useCases = new NoteUseCases(repository);

    await expect(useCases.create(document)).resolves.toMatchObject({ title: "Daily note" });
    await expect(useCases.updateMarkdown("owner", "note-1", "# Updated", "device")).resolves.toBe(
      document,
    );
    expect(create).toHaveBeenCalledWith({ ...document, title: "Daily note" });
    expect(updateMarkdown).toHaveBeenCalledWith("owner", "note-1", "# Updated", "device");
    expect(() => useCases.rename("owner", "note-1", "   ", "device")).toThrow("title");
  });
});
