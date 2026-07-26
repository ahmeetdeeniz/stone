import type {
  Document,
  NoteDraft,
  NoteListOptions,
  NoteRepository,
  SettingsRepository,
  ThemePreference,
  UserSettings,
} from "./entities.js";
import { ValidationError } from "./errors.js";

export class SettingsUseCases {
  public constructor(private readonly repository: SettingsRepository) {}

  public load(ownerId: string): Promise<UserSettings> {
    return this.repository.get(ownerId);
  }

  public async setTheme(ownerId: string, theme: ThemePreference): Promise<UserSettings> {
    const current = await this.repository.get(ownerId);
    const updated: UserSettings = { ...current, theme };
    await this.repository.save(updated);
    return updated;
  }
}

export class NoteUseCases {
  public constructor(private readonly repository: NoteRepository) {}

  public create(document: Document): Promise<Document> {
    if (!document.title.trim()) throw new ValidationError("Note title is required.");
    if (document.kind !== "note")
      throw new ValidationError("Only note documents are supported here.");
    return this.repository.create({ ...document, title: document.title.trim() });
  }

  public list(ownerId: string, options?: NoteListOptions): Promise<readonly Document[]> {
    return this.repository.list(ownerId, options);
  }

  public get(ownerId: string, id: string, includeDeleted = false): Promise<Document | null> {
    return this.repository.getById(ownerId, id, includeDeleted);
  }

  public rename(ownerId: string, id: string, title: string, deviceId: string): Promise<Document> {
    const cleanTitle = title.trim();
    if (!cleanTitle) throw new ValidationError("Note title is required.");
    return this.repository.rename(ownerId, id, cleanTitle, deviceId);
  }

  public updateMarkdown(
    ownerId: string,
    id: string,
    markdown: string,
    deviceId: string,
  ): Promise<Document> {
    if (markdown.length > 512_000) throw new ValidationError("This note is larger than 500 KB.");
    return this.repository.updateMarkdown(ownerId, id, markdown, deviceId);
  }

  public setPinned(
    ownerId: string,
    id: string,
    pinned: boolean,
    deviceId: string,
  ): Promise<Document> {
    return this.repository.setPinned(ownerId, id, pinned, deviceId);
  }

  public trash(ownerId: string, id: string, deviceId: string): Promise<Document> {
    return this.repository.softDelete(ownerId, id, deviceId);
  }

  public restore(ownerId: string, id: string, deviceId: string): Promise<Document> {
    return this.repository.restore(ownerId, id, deviceId);
  }

  public permanentlyDelete(ownerId: string, id: string): Promise<void> {
    return this.repository.permanentlyDelete(ownerId, id);
  }

  public revisions(ownerId: string, id: string) {
    return this.repository.revisions(ownerId, id);
  }

  public restoreRevision(
    ownerId: string,
    id: string,
    revision: number,
    deviceId: string,
  ): Promise<Document> {
    return this.repository.restoreRevision(ownerId, id, revision, deviceId);
  }

  public getDraft(ownerId: string, documentId: string): Promise<NoteDraft | null> {
    return this.repository.getDraft(ownerId, documentId);
  }

  public saveDraft(draft: NoteDraft): Promise<void> {
    if (draft.markdown.length > 512_000)
      throw new ValidationError("This draft is larger than 500 KB.");
    return this.repository.saveDraft(draft);
  }

  public clearDraft(ownerId: string, documentId: string): Promise<void> {
    return this.repository.clearDraft(ownerId, documentId);
  }
}
