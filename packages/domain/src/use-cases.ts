import type {
  Document,
  Project,
  ProjectBlocker,
  ProjectDecision,
  NoteDraft,
  NoteListOptions,
  NoteRepository,
  ProjectCreateInput,
  ProjectListOptions,
  ProjectRepository,
  ProjectUpdate,
  VersionCreateInput,
  VersionUpdate,
  SettingsRepository,
  ThemePreference,
  UserSettings,
} from "./entities.js";
import { ValidationError } from "./errors.js";
import { canTransitionProjectStatus, isValidIsoDate } from "./project-logic.js";

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

export class ProjectUseCases {
  public constructor(private readonly repository: ProjectRepository) {}

  public create(input: ProjectCreateInput): Promise<Project> {
    if (!input.project.title.trim()) throw new ValidationError("Project title is required.");
    if (!input.project.slug.trim()) throw new ValidationError("Project slug is required.");
    if (input.project.targetDate && !isValidIsoDate(input.project.targetDate)) {
      throw new ValidationError("Project target date must be YYYY-MM-DD.");
    }
    return this.repository.create({
      ...input,
      project: {
        ...input.project,
        title: input.project.title.trim(),
        slug: input.project.slug.trim(),
      },
    });
  }

  public list(ownerId: string, options?: ProjectListOptions) {
    return this.repository.list(ownerId, options);
  }

  public get(ownerId: string, id: string) {
    return this.repository.getById(ownerId, id);
  }

  public update(ownerId: string, id: string, changes: ProjectUpdate, deviceId: string) {
    if (changes.targetDate && !isValidIsoDate(changes.targetDate)) {
      throw new ValidationError("Project target date must be YYYY-MM-DD.");
    }
    if (changes.status) {
      const currentPromise = this.repository.getById(ownerId, id);
      return currentPromise.then((current) => {
        if (!current) throw new ValidationError("Project not found.");
        if (!canTransitionProjectStatus(current.status, changes.status!)) {
          throw new ValidationError("Project status transition is invalid.");
        }
        return this.repository.update(ownerId, id, changes, deviceId);
      });
    }
    return this.repository.update(ownerId, id, changes, deviceId);
  }

  public createVersion(input: VersionCreateInput) {
    if (!input.version.version.trim()) throw new ValidationError("Version is required.");
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(input.version.version.trim())) {
      throw new ValidationError("Version contains unsupported path characters.");
    }
    if (input.version.targetDate && !isValidIsoDate(input.version.targetDate)) {
      throw new ValidationError("Version target date must be YYYY-MM-DD.");
    }
    return this.repository.createVersion(input);
  }

  public updateVersion(ownerId: string, id: string, changes: VersionUpdate, deviceId: string) {
    if (changes.targetDate && !isValidIsoDate(changes.targetDate)) {
      throw new ValidationError("Version target date must be YYYY-MM-DD.");
    }
    return this.repository.updateVersion(ownerId, id, changes, deviceId);
  }

  public versions(ownerId: string, projectId: string) {
    return this.repository.versions(ownerId, projectId);
  }

  public getVersion(ownerId: string, id: string) {
    return this.repository.getVersion(ownerId, id);
  }

  public tasks(ownerId: string, projectId?: string) {
    return this.repository.tasks(ownerId, projectId);
  }

  public toggleTask(ownerId: string, taskId: string, completed: boolean, deviceId: string) {
    return this.repository.toggleTask(ownerId, taskId, completed, deviceId);
  }

  public blockers(ownerId: string, projectId: string) {
    return this.repository.blockers(ownerId, projectId);
  }

  public addBlocker(ownerId: string, blocker: ProjectBlocker, deviceId: string) {
    if (!blocker.text.trim()) throw new ValidationError("Blocker text is required.");
    return this.repository.addBlocker(ownerId, { ...blocker, text: blocker.text.trim() }, deviceId);
  }

  public resolveBlocker(ownerId: string, id: string, resolvedAt: string, deviceId: string) {
    return this.repository.resolveBlocker(ownerId, id, resolvedAt, deviceId);
  }

  public addInboxItem(ownerId: string, text: string, deviceId: string) {
    if (!text.trim()) throw new ValidationError("Inbox text is required.");
    return this.repository.addInboxItem(ownerId, text.trim(), deviceId);
  }

  public addDecision(ownerId: string, decision: ProjectDecision, deviceId: string) {
    if (!decision.title.trim() || !decision.decision.trim()) {
      throw new ValidationError("Decision title and decision are required.");
    }
    return this.repository.addDecision(ownerId, decision, deviceId);
  }

  public today(ownerId: string, now: string) {
    return this.repository.today(ownerId, now);
  }

  public exportProject(ownerId: string, projectId: string) {
    return this.repository.exportProject(ownerId, projectId);
  }
}
