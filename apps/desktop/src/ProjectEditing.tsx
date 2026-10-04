import { useState, type FormEvent } from "react";
import { projectPriorities, projectStatuses } from "@stone/domain";
import { formatProjectPriority, formatProjectStatus, type TranslationKey } from "@stone/i18n";
import type { ProjectTemplate } from "@stone/markdown";
import { desktopApi, type DesktopDocument, type DesktopProject } from "./desktop-api";
import { useI18n } from "./i18n";
import { applyProjectChanges, createDesktopProject, optionalText } from "./project-editing";

const templates: readonly ProjectTemplate[] = [
  "general",
  "blank",
  "mobile_app",
  "game",
  "website",
  "programming_tooling",
];

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : typeof error === "string" ? error : fallback;
}

export function NewProjectForm({
  onCreated,
}: {
  onCreated: (project: DesktopProject, documents: DesktopDocument[]) => void;
}) {
  const { t } = useI18n();
  const [title, setTitle] = useState("");
  const [template, setTemplate] = useState<ProjectTemplate>("general");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const draft = createDesktopProject({
        title,
        template,
        now: new Date().toISOString(),
        newId: () => crypto.randomUUID(),
      });
      const documents: DesktopDocument[] = [];
      for (const document of draft.documents) {
        documents.push(await desktopApi.saveDocument(document));
      }
      const project = await desktopApi.saveProject(draft.project);
      setTitle("");
      onCreated(project, documents);
    } catch (caught) {
      setError(`${t("projects.createFailed")}: ${errorText(caught, t("app.unknownError"))}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="project-create-form" onSubmit={(event) => void submit(event)}>
      <label>
        {t("projects.new")}
        <input
          value={title}
          maxLength={512}
          placeholder={t("tasks.titleField")}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <label>
        {t("projects.template")}
        <select
          value={template}
          onChange={(event) => setTemplate(event.target.value as ProjectTemplate)}
        >
          {templates.map((value) => (
            <option key={value} value={value}>
              {t(`projects.template.${value}` as TranslationKey)}
            </option>
          ))}
        </select>
      </label>
      <button className="primary-button compact" type="submit" disabled={busy || !title.trim()}>
        {t("desktop.createProject")}
      </button>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

export function ProjectEditorForm({
  project,
  document,
  onSaved,
  onCancel,
}: {
  project: DesktopProject;
  document: DesktopDocument;
  onSaved: (project: DesktopProject, document: DesktopDocument) => void;
  onCancel: () => void;
}) {
  const { locale, t } = useI18n();
  const [title, setTitle] = useState(project.title);
  const [status, setStatus] = useState(project.status);
  const [priority, setPriority] = useState(project.priority);
  const [targetDate, setTargetDate] = useState(project.targetDate ?? "");
  const [currentVersion, setCurrentVersion] = useState(project.currentVersion ?? "");
  const [nextVersion, setNextVersion] = useState(project.nextVersion ?? "");
  const [nextAction, setNextAction] = useState(project.nextAction ?? "");
  const [repositoryUrl, setRepositoryUrl] = useState(project.repositoryUrl ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const next = applyProjectChanges(project, document.markdown, {
        title,
        status,
        priority,
        targetDate: optionalText(targetDate),
        currentVersion: optionalText(currentVersion),
        nextVersion: optionalText(nextVersion),
        nextAction: optionalText(nextAction),
        repositoryUrl: optionalText(repositoryUrl),
      });
      const savedDocument = await desktopApi.saveDocument({
        id: document.id,
        title: next.project.title,
        markdown: next.markdown,
        path: document.path,
      });
      const savedProject = await desktopApi.saveProject(next.project);
      onSaved(savedProject, savedDocument);
    } catch (caught) {
      setError(errorText(caught, t("app.unknownError")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="project-editor-form" onSubmit={(event) => void submit(event)}>
      <label>
        {t("tasks.titleField")}
        <input value={title} maxLength={512} onChange={(event) => setTitle(event.target.value)} />
      </label>
      <label>
        {t("projects.statusTitle")}
        <select value={status} onChange={(event) => setStatus(event.target.value)}>
          {projectStatuses.map((value) => (
            <option key={value} value={value}>
              {formatProjectStatus(locale, value)}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t("projects.priority")}
        <select value={priority} onChange={(event) => setPriority(event.target.value)}>
          {projectPriorities.map((value) => (
            <option key={value} value={value}>
              {formatProjectPriority(locale, value)}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t("projects.targetDateField")}
        <input
          type="date"
          value={targetDate}
          onChange={(event) => setTargetDate(event.target.value)}
        />
      </label>
      <label>
        {t("projects.currentVersion")}
        <input value={currentVersion} onChange={(event) => setCurrentVersion(event.target.value)} />
      </label>
      <label>
        {t("projects.nextVersion")}
        <input value={nextVersion} onChange={(event) => setNextVersion(event.target.value)} />
      </label>
      <label>
        {t("projects.nextAction")}
        <input value={nextAction} onChange={(event) => setNextAction(event.target.value)} />
      </label>
      <label>
        {t("projects.repositoryUrl")}
        <input
          type="url"
          value={repositoryUrl}
          onChange={(event) => setRepositoryUrl(event.target.value)}
        />
      </label>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <div className="button-row">
        <button className="secondary-button" type="button" onClick={onCancel}>
          {t("common.cancel")}
        </button>
        <button className="primary-button compact" type="submit" disabled={busy}>
          {busy ? t("projects.saving") : t("common.save")}
        </button>
      </div>
    </form>
  );
}
