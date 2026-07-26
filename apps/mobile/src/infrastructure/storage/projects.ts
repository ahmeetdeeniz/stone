import * as Crypto from "expo-crypto";
import {
  buildTodayItems,
  calculateProjectHealth,
  type Document,
  type ExportedProjectFile,
  type Project,
  type ProjectBlocker,
  type ProjectDecision,
  type ProjectListOptions,
  type ProjectPlatform,
  type ProjectPriority,
  type ProjectRepository,
  type ProjectStatus,
  type ProjectTask,
  type ProjectUpdate,
  type ProjectVersion,
  type TodayItem,
  type VersionCreateInput,
  type VersionUpdate,
} from "@stone/domain";
import {
  createProjectDocumentSet,
  calculateTaskProgress,
  extractTasks,
  normalizeMarkdown,
  serializeStoneTaskMetadata,
  toggleTask,
  updateProjectFrontmatter,
  updateTaskMetadata,
  updateVersionFrontmatter,
} from "@stone/markdown";
import { StorageError } from "@stone/domain";
import type { StoneDatabase } from "./database";

interface ProjectRow {
  id: string;
  owner_id: string;
  canonical_document_id: string;
  title: string;
  slug: string;
  status: string;
  priority: string;
  tags: string;
  target_date: string | null;
  current_version: string | null;
  next_version: string | null;
  next_action: string | null;
  repository_url: string | null;
  platforms: string;
  health: string;
  revision: number;
  created_at: string | null;
  updated_at: string;
  deleted_at: string | null;
  updated_by_device_id: string;
}

interface VersionRow {
  id: string;
  owner_id: string;
  project_id: string;
  canonical_document_id: string;
  version: string;
  status: string;
  target_date: string | null;
  android_status: string;
  ios_status: string;
  completed_tasks: number;
  total_tasks: number;
  revision: number;
  created_at: string | null;
  updated_at: string;
  deleted_at: string | null;
  updated_by_device_id: string;
}

interface DocumentRow {
  id: string;
  owner_id: string;
  kind: string;
  title: string;
  markdown: string;
  path: string | null;
  project_id: string | null;
  is_pinned: number;
  revision: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  updated_by_device_id: string;
}

interface TaskRow {
  id: string;
  owner_id: string;
  document_id: string;
  project_id: string | null;
  version_id: string | null;
  line_anchor: string;
  text: string;
  completed: number;
  priority: string | null;
  due_date: string | null;
  blocked: number;
  blocker_text: string | null;
  canceled: number;
  revision: number;
  updated_at: string;
}

interface BlockerRow {
  id: string;
  owner_id: string;
  project_id: string;
  task_id: string | null;
  text: string;
  resolved: number;
  created_at: string;
  resolved_at: string | null;
}

export class SQLiteProjectRepository implements ProjectRepository {
  public constructor(private readonly database: StoneDatabase) {}

  public async create(input: {
    project: Project;
    documents: readonly Document[];
  }): Promise<Project> {
    return withStorageError(async () => {
      const project = input.project;
      await this.database.withTransactionAsync(async () => {
        await this.database.runAsync(
          "INSERT INTO projects (id, owner_id, canonical_document_id, title, status, priority, updated_at, slug, tags, target_date, current_version, next_version, next_action, repository_url, platforms, health, revision, created_at, deleted_at, updated_by_device_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          project.id,
          project.ownerId,
          project.canonicalDocumentId,
          project.title,
          project.status,
          project.priority,
          project.updatedAt,
          project.slug,
          JSON.stringify(project.tags),
          project.targetDate,
          project.currentVersion,
          project.nextVersion,
          project.nextAction,
          project.repositoryUrl,
          JSON.stringify(project.platforms),
          project.health,
          project.revision,
          project.createdAt,
          project.deletedAt,
          project.updatedByDeviceId,
        );
        for (const document of input.documents) {
          await this.insertDocument(document);
          await this.replaceTaskIndex(document);
        }
      });
      return project;
    });
  }

  public async getById(ownerId: string, id: string): Promise<Project | null> {
    return withStorageError(async () => {
      const row = await this.database.getFirstAsync<ProjectRow>(
        "SELECT id, owner_id, canonical_document_id, title, slug, status, priority, tags, target_date, current_version, next_version, next_action, repository_url, platforms, health, revision, created_at, updated_at, deleted_at, updated_by_device_id FROM projects WHERE owner_id = ? AND id = ? AND deleted_at IS NULL",
        ownerId,
        id,
      );
      return row ? toProject(row) : null;
    });
  }

  public async list(
    ownerId: string,
    options: ProjectListOptions = {},
  ): Promise<readonly Project[]> {
    return withStorageError(async () => {
      const conditions = ["owner_id = ?", "deleted_at IS NULL"];
      const args: (string | number)[] = [ownerId];
      if (!options.includeArchived) conditions.push("status != 'archived'");
      if (options.status) {
        conditions.push("status = ?");
        args.push(options.status);
      }
      if (options.priority) {
        conditions.push("priority = ?");
        args.push(options.priority);
      }
      if (options.tag) {
        conditions.push("tags LIKE ?");
        args.push(`%"${options.tag}%`);
      }
      if (options.platform) {
        conditions.push("platforms LIKE ?");
        args.push(`%"${options.platform}"%`);
      }
      if (options.search?.trim()) {
        conditions.push("(title LIKE ? OR next_action LIKE ?)");
        const search = `%${options.search.trim()}%`;
        args.push(search, search);
      }
      const rows = await this.database.getAllAsync<ProjectRow>(
        `SELECT id, owner_id, canonical_document_id, title, slug, status, priority, tags, target_date, current_version, next_version, next_action, repository_url, platforms, health, revision, created_at, updated_at, deleted_at, updated_by_device_id FROM projects WHERE ${conditions.join(" AND ")} ORDER BY CASE priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END, updated_at DESC`,
        ...args,
      );
      return rows.map(toProject);
    });
  }

  public async update(
    ownerId: string,
    id: string,
    changes: ProjectUpdate,
    deviceId: string,
  ): Promise<Project> {
    return withStorageError(async () => {
      let updated: Project | null = null;
      await this.database.withTransactionAsync(async () => {
        const current = await this.requireProject(ownerId, id);
        const document = await this.requireDocument(ownerId, current.canonicalDocumentId);
        const next: Project = {
          ...current,
          ...changes,
          title: changes.title?.trim() || current.title,
          tags: changes.tags ?? current.tags,
          platforms: changes.platforms ?? current.platforms,
          revision: current.revision + 1,
          updatedAt: new Date().toISOString(),
          updatedByDeviceId: deviceId,
        };
        let markdown = updateProjectFrontmatter(document.markdown, {
          status: next.status,
          priority: next.priority,
          tags: [...next.tags],
          currentVersion: next.currentVersion,
          nextVersion: next.nextVersion,
          targetDate: next.targetDate,
          platforms: [...next.platforms],
          repositoryUrl: next.repositoryUrl,
          nextAction: next.nextAction,
        });
        if (next.title !== current.title) markdown = replaceProjectTitle(markdown, next.title);
        await this.updateDocument(document, markdown, next.title, deviceId);
        await this.database.runAsync(
          "UPDATE projects SET title = ?, status = ?, priority = ?, tags = ?, target_date = ?, current_version = ?, next_version = ?, next_action = ?, repository_url = ?, platforms = ?, revision = ?, updated_at = ?, updated_by_device_id = ? WHERE owner_id = ? AND id = ?",
          next.title,
          next.status,
          next.priority,
          JSON.stringify(next.tags),
          next.targetDate,
          next.currentVersion,
          next.nextVersion,
          next.nextAction,
          next.repositoryUrl,
          JSON.stringify(next.platforms),
          next.revision,
          next.updatedAt,
          next.updatedByDeviceId,
          ownerId,
          id,
        );
        updated = await this.refreshHealth(next);
      });
      if (!updated) throw new StorageError("Project update did not complete.");
      return updated;
    });
  }

  public async versions(ownerId: string, projectId: string): Promise<readonly ProjectVersion[]> {
    return withStorageError(async () => {
      const rows = await this.database.getAllAsync<VersionRow>(
        "SELECT id, owner_id, project_id, canonical_document_id, version, status, target_date, android_status, ios_status, completed_tasks, total_tasks, revision, created_at, updated_at, deleted_at, updated_by_device_id FROM versions WHERE owner_id = ? AND project_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC",
        ownerId,
        projectId,
      );
      return rows.map(toVersion);
    });
  }

  public async createVersion(input: VersionCreateInput): Promise<ProjectVersion> {
    return withStorageError(async () => {
      await this.database.withTransactionAsync(async () => {
        await this.database.runAsync(
          "INSERT INTO versions (id, owner_id, project_id, canonical_document_id, version, status, updated_at, target_date, android_status, ios_status, completed_tasks, total_tasks, revision, created_at, deleted_at, updated_by_device_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          input.version.id,
          input.version.ownerId,
          input.version.projectId,
          input.version.canonicalDocumentId,
          input.version.version,
          input.version.status,
          input.version.updatedAt,
          input.version.targetDate,
          input.version.androidStatus,
          input.version.iosStatus,
          input.version.completedTasks,
          input.version.totalTasks,
          input.version.revision,
          input.version.createdAt,
          input.version.deletedAt,
          input.version.updatedByDeviceId,
        );
        await this.insertDocument(input.document);
        await this.replaceTaskIndex(input.document, input.version.projectId, input.version.id);
        const project = await this.requireProject(input.version.ownerId, input.version.projectId);
        await this.touchProject(project, input.version.updatedByDeviceId);
      });
      return input.version;
    });
  }

  public async getVersion(ownerId: string, id: string): Promise<ProjectVersion | null> {
    return withStorageError(async () => {
      const row = await this.database.getFirstAsync<VersionRow>(
        "SELECT id, owner_id, project_id, canonical_document_id, version, status, target_date, android_status, ios_status, completed_tasks, total_tasks, revision, created_at, updated_at, deleted_at, updated_by_device_id FROM versions WHERE owner_id = ? AND id = ? AND deleted_at IS NULL",
        ownerId,
        id,
      );
      return row ? toVersion(row) : null;
    });
  }

  public async updateVersion(
    ownerId: string,
    id: string,
    changes: VersionUpdate,
    deviceId: string,
  ): Promise<ProjectVersion> {
    return withStorageError(async () => {
      let updated: ProjectVersion | null = null;
      await this.database.withTransactionAsync(async () => {
        const current = await this.requireVersion(ownerId, id);
        const document = await this.requireDocument(ownerId, current.canonicalDocumentId);
        const next: ProjectVersion = {
          ...current,
          ...changes,
          revision: current.revision + 1,
          updatedAt: new Date().toISOString(),
          updatedByDeviceId: deviceId,
        };
        const markdown = updateVersionFrontmatter(document.markdown, {
          status: next.status,
          targetDate: next.targetDate,
          platforms: { android: next.androidStatus, ios: next.iosStatus },
        });
        await this.updateDocument(document, markdown, document.title, deviceId);
        const progress = calculateTaskProgress(markdown);
        next.completedTasks = progress.completed;
        next.totalTasks = progress.total;
        await this.database.runAsync(
          "UPDATE versions SET status = ?, target_date = ?, android_status = ?, ios_status = ?, completed_tasks = ?, total_tasks = ?, revision = ?, updated_at = ?, updated_by_device_id = ? WHERE owner_id = ? AND id = ?",
          next.status,
          next.targetDate,
          next.androidStatus,
          next.iosStatus,
          next.completedTasks,
          next.totalTasks,
          next.revision,
          next.updatedAt,
          next.updatedByDeviceId,
          ownerId,
          id,
        );
        await this.replaceTaskIndex({ ...document, markdown });
        const project = await this.requireProject(ownerId, current.projectId);
        await this.touchProject(project, deviceId);
        updated = next;
      });
      if (!updated) throw new StorageError("Version update did not complete.");
      return updated;
    });
  }

  public async tasks(ownerId: string, projectId?: string): Promise<readonly ProjectTask[]> {
    return withStorageError(async () => {
      const rows = await this.database.getAllAsync<TaskRow>(
        `SELECT id, owner_id, document_id, project_id, version_id, line_anchor, text, completed, priority, due_date, blocked, blocker_text, canceled, revision, updated_at FROM tasks_index WHERE owner_id = ? ${projectId ? "AND project_id = ?" : ""} ORDER BY due_date IS NULL, due_date, updated_at DESC`,
        ...(projectId ? [ownerId, projectId] : [ownerId]),
      );
      return rows.map(toTask);
    });
  }

  public async toggleTask(
    ownerId: string,
    taskId: string,
    completed: boolean,
    deviceId: string,
  ): Promise<ProjectTask> {
    return withStorageError(async () => {
      let result: ProjectTask | null = null;
      await this.database.withTransactionAsync(async () => {
        const indexed = await this.database.getFirstAsync<TaskRow>(
          "SELECT id, owner_id, document_id, project_id, version_id, line_anchor, text, completed, priority, due_date, blocked, blocker_text, canceled, revision, updated_at FROM tasks_index WHERE owner_id = ? AND id = ?",
          ownerId,
          taskId,
        );
        if (!indexed) throw new StorageError("Task not found.");
        const document = await this.requireDocument(ownerId, indexed.document_id);
        const task = extractTasks(document.markdown).find(
          (candidate) => candidate.id === indexed.id || candidate.text === indexed.text,
        );
        if (!task) throw new StorageError("Task is missing from its canonical Markdown document.");
        const markdown = toggleTask(document.markdown, task, completed);
        await this.updateDocument(document, markdown, document.title, deviceId);
        await this.replaceTaskIndex(
          { ...document, markdown },
          indexed.project_id,
          indexed.version_id,
        );
        const refreshed = await this.database.getFirstAsync<TaskRow>(
          "SELECT id, owner_id, document_id, project_id, version_id, line_anchor, text, completed, priority, due_date, blocked, blocker_text, canceled, revision, updated_at FROM tasks_index WHERE owner_id = ? AND document_id = ? AND text = ? ORDER BY updated_at DESC LIMIT 1",
          ownerId,
          indexed.document_id,
          indexed.text,
        );
        if (!refreshed) throw new StorageError("Task index update did not complete.");
        result = toTask(refreshed);
        if (indexed.version_id) {
          await this.refreshVersionProgress(indexed.version_id, ownerId, deviceId);
        }
        if (indexed.project_id) {
          const project = await this.requireProject(ownerId, indexed.project_id);
          await this.refreshHealth(await this.touchProject(project, deviceId));
        }
      });
      if (!result) throw new StorageError("Task update did not complete.");
      return result;
    });
  }

  public async blockers(ownerId: string, projectId: string): Promise<readonly ProjectBlocker[]> {
    return withStorageError(async () => {
      const rows = await this.database.getAllAsync<BlockerRow>(
        "SELECT id, owner_id, project_id, task_id, text, resolved, created_at, resolved_at FROM project_blockers WHERE owner_id = ? AND project_id = ? ORDER BY resolved, created_at DESC",
        ownerId,
        projectId,
      );
      return rows.map(toBlocker);
    });
  }

  public async addBlocker(
    ownerId: string,
    blocker: ProjectBlocker,
    deviceId: string,
  ): Promise<ProjectBlocker> {
    return withStorageError(async () => {
      const project = await this.requireProject(ownerId, blocker.projectId);
      await this.database.withTransactionAsync(async () => {
        await this.database.runAsync(
          "INSERT INTO project_blockers (id, owner_id, project_id, task_id, text, resolved, created_at, resolved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          blocker.id,
          project.ownerId,
          blocker.projectId,
          blocker.taskId,
          blocker.text,
          blocker.resolved ? 1 : 0,
          blocker.createdAt,
          blocker.resolvedAt,
        );
        const document = await this.requireDocument(project.ownerId, project.canonicalDocumentId);
        const updatedDocument = await this.updateDocument(
          document,
          appendToSection(
            document.markdown,
            "## Blocker'lar",
            `\n- [ ] ${blocker.text}\n${serializeBlockerMetadata(blocker)}`,
          ),
          document.title,
          deviceId,
        );
        await this.replaceTaskIndex(updatedDocument, project.id);
        await this.refreshHealth(await this.touchProject(project, deviceId));
      });
      return blocker;
    });
  }

  public async resolveBlocker(
    ownerId: string,
    id: string,
    resolvedAt: string,
    deviceId: string,
  ): Promise<void> {
    return withStorageError(async () => {
      const row = await this.database.getFirstAsync<BlockerRow>(
        "SELECT id, owner_id, project_id, task_id, text, resolved, created_at, resolved_at FROM project_blockers WHERE owner_id = ? AND id = ?",
        ownerId,
        id,
      );
      if (!row) throw new StorageError("Blocker not found.");
      await this.database.withTransactionAsync(async () => {
        await this.database.runAsync(
          "UPDATE project_blockers SET resolved = 1, resolved_at = ? WHERE owner_id = ? AND id = ?",
          resolvedAt,
          ownerId,
          id,
        );
        const project = await this.requireProject(ownerId, row.project_id);
        const document = await this.requireDocument(ownerId, project.canonicalDocumentId);
        const task = extractTasks(document.markdown).find(
          (candidate) => candidate.metadata?.id === row.id || candidate.text === row.text,
        );
        let markdown = task
          ? toggleTask(document.markdown, task, true)
          : replaceFirst(document.markdown, `- [ ] ${row.text}`, `- [x] ${row.text}`);
        const refreshedTask = task
          ? extractTasks(markdown).find(
              (candidate) => candidate.metadata?.id === row.id || candidate.text === row.text,
            )
          : undefined;
        if (refreshedTask) {
          markdown = updateTaskMetadata(markdown, refreshedTask, {
            blocked: false,
            blocker: null,
          });
        }
        const updatedDocument = await this.updateDocument(
          document,
          markdown,
          document.title,
          deviceId,
        );
        await this.replaceTaskIndex(updatedDocument, project.id);
        await this.refreshHealth(await this.touchProject(project, deviceId));
      });
    });
  }

  public async addInboxItem(ownerId: string, text: string, deviceId: string): Promise<Document> {
    return withStorageError(async () => {
      let document = await this.database.getFirstAsync<DocumentRow>(
        "SELECT id, owner_id, kind, title, markdown, path, project_id, is_pinned, revision, created_at, updated_at, deleted_at, updated_by_device_id FROM documents WHERE owner_id = ? AND kind = 'inbox' AND project_id IS NULL AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 1",
        ownerId,
      );
      if (!document) {
        const now = new Date().toISOString();
        const created: Document = {
          id: Crypto.randomUUID(),
          ownerId,
          kind: "inbox",
          title: "Inbox",
          markdown: createProjectDocumentSet().inbox,
          path: "Inbox.md",
          projectId: null,
          isPinned: false,
          revision: 1,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
          updatedByDeviceId: deviceId,
        };
        await this.database.withTransactionAsync(async () => {
          await this.insertDocument(created);
          await this.replaceTaskIndex(created);
        });
        document = await this.database.getFirstAsync<DocumentRow>(
          "SELECT id, owner_id, kind, title, markdown, path, project_id, is_pinned, revision, created_at, updated_at, deleted_at, updated_by_device_id FROM documents WHERE id = ?",
          created.id,
        );
      }
      if (!document) throw new StorageError("Inbox creation did not complete.");
      const current = toDocument(document);
      const updated = await this.updateDocument(
        current,
        appendToSection(current.markdown, "# Inbox", `\n- ${text}`),
        current.title,
        deviceId,
      );
      await this.replaceTaskIndex(updated);
      return updated;
    });
  }

  public async addDecision(
    ownerId: string,
    decision: ProjectDecision,
    deviceId: string,
  ): Promise<Document> {
    return withStorageError(async () => {
      const project = await this.requireProject(ownerId, decision.projectId);
      const documentRow = await this.database.getFirstAsync<DocumentRow>(
        "SELECT id, owner_id, kind, title, markdown, path, project_id, is_pinned, revision, created_at, updated_at, deleted_at, updated_by_device_id FROM documents WHERE owner_id = ? AND project_id = ? AND kind = 'decision_log' AND deleted_at IS NULL LIMIT 1",
        ownerId,
        project.id,
      );
      if (!documentRow) throw new StorageError("Decision log not found.");
      const document = toDocument(documentRow);
      const section = `\n## ${decision.date} — ${decision.title}\n\n### Karar\n\n${decision.decision}\n\n### Neden\n\n${decision.reason || "-"}\n\n### Alternatifler\n\n${decision.alternatives || "-"}\n\n### Sonuç\n\n${decision.outcome || "-"}\n`;
      const updated = await this.updateDocument(
        document,
        `${normalizeMarkdown(document.markdown)}${section}`,
        document.title,
        deviceId,
      );
      await this.refreshHealth(await this.touchProject(project, deviceId));
      return updated;
    });
  }

  public async today(ownerId: string, now: string): Promise<readonly TodayItem[]> {
    const projects = await this.list(ownerId);
    const tasks = await this.tasks(ownerId);
    const blockers = (
      await Promise.all(projects.map((project) => this.blockers(ownerId, project.id)))
    ).flat();
    return buildTodayItems(projects, tasks, now.slice(0, 10), blockers);
  }

  public async exportProject(
    ownerId: string,
    projectId: string,
  ): Promise<readonly ExportedProjectFile[]> {
    return withStorageError(async () => {
      const project = await this.requireProject(ownerId, projectId);
      const documents = await this.database.getAllAsync<DocumentRow>(
        "SELECT id, owner_id, kind, title, markdown, path, project_id, is_pinned, revision, created_at, updated_at, deleted_at, updated_by_device_id FROM documents WHERE owner_id = ? AND (id = ? OR project_id = ?) AND deleted_at IS NULL ORDER BY path",
        ownerId,
        project.canonicalDocumentId,
        projectId,
      );
      const versions = await this.database.getAllAsync<{
        canonical_document_id: string;
        version: string;
      }>(
        "SELECT canonical_document_id, version FROM versions WHERE owner_id = ? AND project_id = ? AND deleted_at IS NULL",
        ownerId,
        projectId,
      );
      const versionIds = new Set(versions.map((version) => version.canonical_document_id));
      const files = documents.map((document) => ({
        path: document.path ?? documentPath(project, toDocument(document)),
        content: document.markdown,
      }));
      for (const version of versions) {
        if (
          versionIds.has(version.canonical_document_id) &&
          !files.some((file) => file.path.endsWith(`Versions/${version.version}.md`))
        ) {
          const document = await this.requireDocument(ownerId, version.canonical_document_id);
          files.push({
            path: `Projects/${project.slug}/Versions/${version.version}.md`,
            content: document.markdown,
          });
        }
      }
      return files.sort((left, right) => left.path.localeCompare(right.path));
    });
  }

  private async insertDocument(document: Document): Promise<void> {
    const markdown = normalizeMarkdown(document.markdown);
    await this.database.runAsync(
      "INSERT INTO documents (id, owner_id, kind, title, markdown, path, project_id, is_pinned, revision, created_at, updated_at, deleted_at, updated_by_device_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      document.id,
      document.ownerId,
      document.kind,
      document.title,
      markdown,
      document.path,
      document.projectId,
      document.isPinned ? 1 : 0,
      document.revision,
      document.createdAt,
      document.updatedAt,
      document.deletedAt,
      document.updatedByDeviceId,
    );
    await this.database.runAsync(
      "INSERT INTO document_revisions (id, document_id, revision, markdown, created_at) VALUES (?, ?, ?, ?, ?)",
      `${document.id}:${document.revision}`,
      document.id,
      document.revision,
      markdown,
      document.updatedAt,
    );
    await this.replaceSearchIndex({ ...document, markdown });
  }

  private async updateDocument(
    document: Document,
    markdown: string,
    title: string,
    deviceId: string,
  ): Promise<Document> {
    const next: Document = {
      ...document,
      title,
      markdown: normalizeMarkdown(markdown),
      revision: document.revision + 1,
      updatedAt: new Date().toISOString(),
      updatedByDeviceId: deviceId,
    };
    await this.database.runAsync(
      "UPDATE documents SET title = ?, markdown = ?, revision = ?, updated_at = ?, updated_by_device_id = ? WHERE owner_id = ? AND id = ?",
      next.title,
      next.markdown,
      next.revision,
      next.updatedAt,
      next.updatedByDeviceId,
      document.ownerId,
      document.id,
    );
    await this.database.runAsync(
      "INSERT INTO document_revisions (id, document_id, revision, markdown, created_at) VALUES (?, ?, ?, ?, ?)",
      `${next.id}:${next.revision}`,
      next.id,
      next.revision,
      next.markdown,
      next.updatedAt,
    );
    await this.replaceSearchIndex(next);
    return next;
  }

  private async replaceSearchIndex(document: Document): Promise<void> {
    await this.database.runAsync("DELETE FROM documents_fts WHERE document_id = ?", document.id);
    if (!document.deletedAt) {
      await this.database.runAsync(
        "INSERT INTO documents_fts (document_id, owner_id, title, markdown) VALUES (?, ?, ?, ?)",
        document.id,
        document.ownerId,
        document.title,
        document.markdown,
      );
    }
  }

  private async replaceTaskIndex(
    document: Document,
    projectId = document.projectId,
    versionId: string | null = null,
  ): Promise<void> {
    if (!["project", "version", "inbox", "release_checklist"].includes(document.kind)) return;
    const resolvedVersionId = versionId ?? (await this.versionIdForDocument(document.id));
    await this.database.runAsync(
      "DELETE FROM tasks_index WHERE owner_id = ? AND document_id = ?",
      document.ownerId,
      document.id,
    );
    for (const task of extractTasks(document.markdown)) {
      await this.database.runAsync(
        "INSERT INTO tasks_index (id, owner_id, document_id, text, completed, updated_at, project_id, version_id, line_anchor, priority, due_date, blocked, blocker_text, canceled, revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        task.metadata?.id ?? task.id,
        document.ownerId,
        document.id,
        task.text,
        task.checked ? 1 : 0,
        document.updatedAt,
        projectId,
        resolvedVersionId,
        `${task.from}:${task.to}`,
        task.metadata?.priority ?? null,
        task.metadata?.due ?? null,
        task.metadata?.blocked ? 1 : 0,
        task.metadata?.blocker ?? null,
        task.canceled ? 1 : 0,
        document.revision,
      );
    }
  }

  private async versionIdForDocument(documentId: string): Promise<string | null> {
    const row = await this.database.getFirstAsync<{ id: string }>(
      "SELECT id FROM versions WHERE canonical_document_id = ? AND deleted_at IS NULL",
      documentId,
    );
    return row?.id ?? null;
  }

  private async refreshVersionProgress(
    versionId: string,
    ownerId: string,
    deviceId: string,
  ): Promise<void> {
    const version = await this.requireVersion(ownerId, versionId);
    const progress = await this.database.getFirstAsync<{ completed: number; total: number }>(
      "SELECT COALESCE(SUM(completed), 0) AS completed, COUNT(*) AS total FROM tasks_index WHERE owner_id = ? AND version_id = ? AND canceled = 0",
      ownerId,
      versionId,
    );
    await this.database.runAsync(
      "UPDATE versions SET completed_tasks = ?, total_tasks = ?, revision = revision + 1, updated_at = ?, updated_by_device_id = ? WHERE owner_id = ? AND id = ?",
      progress?.completed ?? 0,
      progress?.total ?? 0,
      new Date().toISOString(),
      deviceId,
      ownerId,
      version.id,
    );
  }

  private async refreshHealth(project: Project): Promise<Project> {
    const taskCounts = await this.database.getFirstAsync<{ open_tasks: number; critical: number }>(
      "SELECT COALESCE(SUM(CASE WHEN completed = 0 AND canceled = 0 THEN 1 ELSE 0 END), 0) AS open_tasks, COALESCE(SUM(CASE WHEN completed = 0 AND canceled = 0 AND blocked = 1 AND priority = 'critical' THEN 1 ELSE 0 END), 0) AS critical FROM tasks_index WHERE owner_id = ? AND project_id = ?",
      project.ownerId,
      project.id,
    );
    const blockerCounts = await this.database.getFirstAsync<{ open_blockers: number }>(
      "SELECT COUNT(*) AS open_blockers FROM project_blockers WHERE owner_id = ? AND project_id = ? AND resolved = 0",
      project.ownerId,
      project.id,
    );
    const checklist = await this.database.getFirstAsync<DocumentRow>(
      "SELECT id, owner_id, kind, title, markdown, path, project_id, is_pinned, revision, created_at, updated_at, deleted_at, updated_by_device_id FROM documents WHERE owner_id = ? AND project_id = ? AND kind = 'release_checklist' AND deleted_at IS NULL LIMIT 1",
      project.ownerId,
      project.id,
    );
    const health = calculateProjectHealth(
      project,
      {
        openTasks: taskCounts?.open_tasks ?? 0,
        openCriticalBlockers: (taskCounts?.critical ?? 0) + (blockerCounts?.open_blockers ?? 0),
        missingStoreChecklist:
          project.status === "store_process" &&
          (!checklist || calculateTaskProgress(checklist.markdown).total === 0),
        lastUpdatedAt: project.updatedAt,
      },
      new Date().toISOString().slice(0, 10),
    );
    if (health.health !== project.health) {
      await this.database.runAsync(
        "UPDATE projects SET health = ? WHERE owner_id = ? AND id = ?",
        health.health,
        project.ownerId,
        project.id,
      );
    }
    return { ...project, health: health.health };
  }

  private async touchProject(project: Project, deviceId: string): Promise<Project> {
    const next: Project = {
      ...project,
      revision: project.revision + 1,
      updatedAt: new Date().toISOString(),
      updatedByDeviceId: deviceId,
    };
    await this.database.runAsync(
      "UPDATE projects SET revision = ?, updated_at = ?, updated_by_device_id = ? WHERE owner_id = ? AND id = ?",
      next.revision,
      next.updatedAt,
      next.updatedByDeviceId,
      project.ownerId,
      project.id,
    );
    return next;
  }

  private async requireProject(ownerId: string, id: string): Promise<Project> {
    const row = await this.database.getFirstAsync<ProjectRow>(
      "SELECT id, owner_id, canonical_document_id, title, slug, status, priority, tags, target_date, current_version, next_version, next_action, repository_url, platforms, health, revision, created_at, updated_at, deleted_at, updated_by_device_id FROM projects WHERE owner_id = ? AND id = ? AND deleted_at IS NULL",
      ownerId,
      id,
    );
    if (!row) throw new StorageError("Project not found.");
    return toProject(row);
  }

  private async requireVersion(ownerId: string, id: string): Promise<ProjectVersion> {
    const row = await this.database.getFirstAsync<VersionRow>(
      "SELECT id, owner_id, project_id, canonical_document_id, version, status, target_date, android_status, ios_status, completed_tasks, total_tasks, revision, created_at, updated_at, deleted_at, updated_by_device_id FROM versions WHERE owner_id = ? AND id = ? AND deleted_at IS NULL",
      ownerId,
      id,
    );
    if (!row) throw new StorageError("Version not found.");
    return toVersion(row);
  }

  private async requireDocument(ownerId: string, id: string, kind?: string): Promise<Document> {
    const row = await this.database.getFirstAsync<DocumentRow>(
      `SELECT id, owner_id, kind, title, markdown, path, project_id, is_pinned, revision, created_at, updated_at, deleted_at, updated_by_device_id FROM documents WHERE owner_id = ? AND id = ? AND deleted_at IS NULL ${kind ? "AND kind = ?" : ""}`,
      ...(kind ? [ownerId, id, kind] : [ownerId, id]),
    );
    if (!row) throw new StorageError("Canonical Markdown document not found.");
    return toDocument(row);
  }
}

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    ownerId: row.owner_id,
    canonicalDocumentId: row.canonical_document_id,
    title: row.title,
    slug: row.slug || slugFromTitle(row.title),
    status: row.status as ProjectStatus,
    priority: row.priority as ProjectPriority,
    tags: parseArray(row.tags),
    targetDate: row.target_date,
    currentVersion: row.current_version,
    nextVersion: row.next_version,
    nextAction: row.next_action,
    repositoryUrl: row.repository_url,
    platforms: parseArray(row.platforms) as ProjectPlatform[],
    health: row.health as Project["health"],
    revision: row.revision,
    createdAt: row.created_at ?? row.updated_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    updatedByDeviceId: row.updated_by_device_id,
  };
}

function toVersion(row: VersionRow): ProjectVersion {
  return {
    id: row.id,
    ownerId: row.owner_id,
    projectId: row.project_id,
    canonicalDocumentId: row.canonical_document_id,
    version: row.version,
    status: row.status as ProjectStatus,
    targetDate: row.target_date,
    androidStatus: row.android_status as ProjectVersion["androidStatus"],
    iosStatus: row.ios_status as ProjectVersion["iosStatus"],
    completedTasks: row.completed_tasks,
    totalTasks: row.total_tasks,
    revision: row.revision,
    createdAt: row.created_at ?? row.updated_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    updatedByDeviceId: row.updated_by_device_id,
  };
}

function toDocument(row: DocumentRow): Document {
  return {
    id: row.id,
    ownerId: row.owner_id,
    kind: row.kind as Document["kind"],
    title: row.title,
    markdown: row.markdown,
    path: row.path,
    projectId: row.project_id,
    isPinned: row.is_pinned === 1,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    updatedByDeviceId: row.updated_by_device_id,
  };
}

function toTask(row: TaskRow): ProjectTask {
  return {
    id: row.id,
    ownerId: row.owner_id,
    documentId: row.document_id,
    projectId: row.project_id,
    versionId: row.version_id,
    lineAnchor: row.line_anchor,
    text: row.text,
    completed: row.completed === 1,
    priority: row.priority as ProjectTask["priority"],
    dueDate: row.due_date,
    blocked: row.blocked === 1,
    blockerText: row.blocker_text,
    canceled: row.canceled === 1,
    revision: row.revision,
    updatedAt: row.updated_at,
  };
}

function toBlocker(row: BlockerRow): ProjectBlocker {
  return {
    id: row.id,
    projectId: row.project_id,
    taskId: row.task_id,
    text: row.text,
    resolved: row.resolved === 1,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  };
}

function parseArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function replaceProjectTitle(markdown: string, title: string): string {
  return markdown.replace(/^(#\s+).+$/mu, `$1${title}`);
}

function appendToSection(markdown: string, heading: string, content: string): string {
  const start = markdown.indexOf(heading);
  if (start < 0) return `${normalizeMarkdown(markdown)}\n${heading}\n${content}\n`;
  const nextHeading = markdown.slice(start + heading.length).search(/^##\s+/mu);
  const insertion = nextHeading < 0 ? markdown.length : start + heading.length + nextHeading;
  return `${markdown.slice(0, insertion).replace(/\s*$/u, "\n")}${content}\n${markdown.slice(insertion)}`;
}

function replaceFirst(markdown: string, search: string, replacement: string): string {
  const index = markdown.indexOf(search);
  return index < 0
    ? markdown
    : `${markdown.slice(0, index)}${replacement}${markdown.slice(index + search.length)}`;
}

function serializeBlockerMetadata(blocker: ProjectBlocker): string {
  return serializeStoneTaskMetadata({
    id: blocker.id,
    blocked: true,
    blocker: blocker.text,
  });
}

function documentPath(project: Project, document: Document): string {
  const name =
    document.kind === "project"
      ? "Project.md"
      : document.kind === "inbox"
        ? "Inbox.md"
        : document.kind === "decision_log"
          ? "Decisions.md"
          : document.kind === "release_checklist"
            ? "Release-Checklist.md"
            : `${document.title}.md`;
  return `Projects/${project.slug}/${name}`;
}

function slugFromTitle(title: string): string {
  return (
    title
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-+|-+$/gu, "") || "project"
  );
}

async function withStorageError<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof StorageError) throw error;
    throw new StorageError(
      error instanceof Error ? error.message : "Local project storage failed.",
    );
  }
}
