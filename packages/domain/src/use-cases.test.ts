import { describe, expect, it, vi } from "vitest";
import {
  NoteUseCases,
  ProjectUseCases,
  SettingsUseCases,
  type Document,
  type NoteRepository,
  type Project,
  type ProjectRepository,
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

describe("project use cases", () => {
  it("validates dates and preserves the repository boundary for status and blockers", async () => {
    const project: Project = {
      id: "project-1",
      ownerId: "owner",
      canonicalDocumentId: "document-1",
      title: "Stone",
      slug: "stone",
      status: "planning",
      priority: "medium",
      tags: [],
      targetDate: null,
      currentVersion: null,
      nextVersion: null,
      nextAction: "Test et",
      repositoryUrl: null,
      platforms: [],
      health: "good",
      revision: 1,
      createdAt: "2026-07-26T00:00:00.000Z",
      updatedAt: "2026-07-26T00:00:00.000Z",
      deletedAt: null,
      updatedByDeviceId: "device",
    };
    const update = vi.fn(() => Promise.resolve(project));
    const addBlocker = vi.fn(() =>
      Promise.resolve({
        id: "blocker-1",
        projectId: project.id,
        taskId: null,
        text: "Beklenen erişim",
        resolved: false,
        createdAt: project.createdAt,
        resolvedAt: null,
      }),
    );
    const repository = {
      create: vi.fn(),
      getById: vi.fn(() => Promise.resolve(project)),
      list: vi.fn(),
      update,
      versions: vi.fn(),
      createVersion: vi.fn(),
      getVersion: vi.fn(),
      updateVersion: vi.fn(),
      tasks: vi.fn(),
      toggleTask: vi.fn(),
      blockers: vi.fn(),
      addBlocker,
      resolveBlocker: vi.fn(),
      addInboxItem: vi.fn(),
      addDecision: vi.fn(),
      today: vi.fn(),
      exportProject: vi.fn(),
    } as unknown as ProjectRepository;
    const useCases = new ProjectUseCases(repository);

    await expect(
      useCases.update("owner", project.id, { status: "development" }, "device"),
    ).resolves.toBe(project);
    await expect(
      useCases.addBlocker(
        "owner",
        {
          id: "blocker-1",
          projectId: project.id,
          taskId: null,
          text: "  Beklenen erişim  ",
          resolved: false,
          createdAt: project.createdAt,
          resolvedAt: null,
        },
        "device",
      ),
    ).resolves.toMatchObject({ text: "Beklenen erişim" });
    expect(update).toHaveBeenCalledWith("owner", project.id, { status: "development" }, "device");
    expect(addBlocker).toHaveBeenCalledWith(
      "owner",
      expect.objectContaining({ text: "Beklenen erişim" }),
      "device",
    );
    expect(() =>
      useCases.update("owner", project.id, { targetDate: "tomorrow" }, "device"),
    ).toThrow("YYYY-MM-DD");
  });
});
