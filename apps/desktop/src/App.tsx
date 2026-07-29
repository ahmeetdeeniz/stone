import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorView, highlightActiveLine } from "@codemirror/view";
import { createEditorState } from "@stone/editor";
import {
  formatInstant,
  formatProjectPriority,
  formatProjectStatus,
  formatTaskPriority,
  formatWeekdayName,
  type TranslationKey,
} from "@stone/i18n";
import { normalizeMarkdown } from "@stone/markdown";
import { listen } from "@tauri-apps/api/event";
import {
  buildAgendaItems,
  deleteCalendarRecurrence,
  editCalendarRecurrence,
  expandCalendarOccurrences,
  exportCalendarIcs,
  filterCalendarItems,
  importCalendarIcs,
  instantToZonedWallTime,
  zonedWallTimeToInstant,
  type AgendaItem,
  type CalendarItem,
  type CalendarRecurrenceEditScope,
} from "@stone/domain";
import GithubPanel from "./GithubPanel";
import FocusPanel from "./FocusPanel";
import {
  buildProjectSummaries,
  buildTodayItems,
  type DesktopProjectSummary,
  type DesktopTodayItem,
} from "./project-summary";
import { transitionSaveState, type SaveState } from "./save-state";
import { restoreDesktopSession } from "./session-restore";
import {
  layoutTimedItems,
  monthGrid,
  moveTimedCalendarItemToSlot,
  shiftTimedCalendarItem,
  weekDates,
} from "./calendar-layout";
import {
  desktopApi,
  isTauri,
  requireFirebaseConfigured,
  type AuthSession,
  type DesktopDocument,
  type DesktopTask,
  type FileFingerprint,
} from "./desktop-api";
import { useI18n } from "./i18n";

type Section = "notes" | "projects" | "tasks" | "calendar" | "today" | "focus" | "settings";
type Theme = "system" | "light" | "dark";
function titleFromMarkdown(markdown: string, fallback: string): string {
  const heading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return heading || fallback;
}

export default function App() {
  const { t } = useI18n();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [authReady, setAuthReady] = useState(!isTauri);
  const [error, setError] = useState<string | null>(null);

  const restoreSession = useCallback(async () => {
    if (!isTauri) return;
    setAuthReady(false);
    setError(null);
    const result = await restoreDesktopSession(desktopApi.authRestore);
    if (result.status === "authenticated") {
      setSession(result.session);
    } else if (result.status === "signed_out") {
      setSession(null);
    } else {
      setError(t("desktop.sessionRestoreFailed", { message: result.message }));
    }
    setAuthReady(true);
  }, [t]);

  useEffect(() => {
    if (!isTauri) return;
    void restoreSession();
  }, [restoreSession]);

  if (!authReady) return <FullState label={t("desktop.preparing")} />;
  if (!session) {
    return (
      <AuthScreen
        onAuthenticated={setSession}
        onError={setError}
        onRestore={() => void restoreSession()}
        error={error}
      />
    );
  }
  return <StoneShell session={session} onSignedOut={() => setSession(null)} />;
}

function AuthScreen({
  onAuthenticated,
  onError,
  onRestore,
  error,
}: {
  onAuthenticated: (session: AuthSession) => void;
  onError: (message: string | null) => void;
  onRestore: () => void;
  error: string | null;
}) {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [resetSent, setResetSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function signIn() {
    setBusy(true);
    onError(null);
    try {
      requireFirebaseConfigured();
      onAuthenticated(await desktopApi.authSignIn(email.trim(), password));
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : t("desktop.signInFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword() {
    setBusy(true);
    onError(null);
    try {
      requireFirebaseConfigured();
      await desktopApi.authPasswordReset(email.trim());
      setResetSent(true);
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : t("desktop.passwordResetFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="auth-title">
        <div className="brand-mark">S</div>
        <p className="eyebrow">STONE</p>
        <h1 id="auth-title">{t("desktop.authHeading")}</h1>
        <p className="muted">{t("desktop.authDetail")}</p>
        <label>
          {t("desktop.email")}
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label>
          {t("desktop.password")}
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {error && (
          <div className="error-text" role="alert">
            <p>{error}</p>
            {error.includes(":") && (
              <button className="text-button" disabled={busy} onClick={onRestore}>
                {t("desktop.retrySession")}
              </button>
            )}
          </div>
        )}
        {resetSent && (
          <p className="success-text" role="status">
            {t("desktop.passwordResetSent")}
          </p>
        )}
        <button
          className="primary-button"
          disabled={busy || !email || !password}
          onClick={() => void signIn()}
        >
          {busy ? t("desktop.pleaseWait") : t("desktop.signIn")}
        </button>
        <button
          className="text-button"
          disabled={busy || !email}
          onClick={() => void resetPassword()}
        >
          {t("desktop.resetPassword")}
        </button>
        {!isTauri && <p className="hint">{t("desktop.tauriDevelopmentHint")}</p>}
      </section>
    </main>
  );
}

function StoneShell({ session, onSignedOut }: { session: AuthSession; onSignedOut: () => void }) {
  const {
    locale,
    preference: localePreference,
    setPreference: setLocalePreference,
    t,
    tp,
  } = useI18n();
  const [section, setSection] = useState<Section>("notes");
  const [theme, setTheme] = useState<Theme>("system");
  const [documents, setDocuments] = useState<DesktopDocument[]>([]);
  const [tasks, setTasks] = useState<DesktopTask[]>([]);
  const [calendarItems, setCalendarItems] = useState<CalendarItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [document, setDocument] = useState<DesktopDocument | null>(null);
  const [fingerprint, setFingerprint] = useState<FileFingerprint | null>(null);
  const [externalChange, setExternalChange] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const editorHost = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView | null>(null);
  const draft = useRef("");
  const projects = useMemo(
    () =>
      buildProjectSummaries(documents).map((project) => {
        const related = tasks.filter((task) => task.projectId === project.id);
        return {
          ...project,
          completedTasks:
            project.completedTasks + related.filter((task) => task.state === "completed").length,
          totalTasks: project.totalTasks + related.length,
        };
      }),
    [documents, tasks],
  );
  const todayItems = useMemo(() => buildTodayItems(projects), [projects]);
  const recentNotes = useMemo(
    () =>
      documents
        .filter((item) => !projects.some((project) => project.documentId === item.id))
        .slice()
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, 4),
    [documents, projects],
  );

  useEffect(() => {
    globalThis.document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    void desktopApi
      .listDocuments()
      .then((items) => {
        setDocuments(items);
        if (items[0]) setSelectedId(items[0].id);
      })
      .catch((caught) => setMessage(toMessage(caught)));
  }, []);

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    const start = `${today.slice(0, 8)}01`;
    const end = `${today.slice(0, 8)}31`;
    void desktopApi
      .listCalendarItems(start, end)
      .then(setCalendarItems)
      .catch((caught) => setMessage(toMessage(caught)));
  }, []);

  useEffect(() => {
    void desktopApi
      .listTasks()
      .then(setTasks)
      .catch((caught) => setMessage(toMessage(caught)));
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setDocument(null);
      return;
    }
    void desktopApi
      .getDocument(selectedId)
      .then(async (item) => {
        setDocument(item);
        draft.current = item?.markdown ?? "";
        setSaveState((current) => transitionSaveState(current, "document_loaded"));
        setExternalChange(false);
        if (item?.path) {
          const linked = await desktopApi.loadLinkedFile(item.path);
          setFingerprint(linked.fingerprint);
        } else {
          setFingerprint(null);
        }
      })
      .catch((caught) => setMessage(toMessage(caught)));
  }, [selectedId]);

  useEffect(() => {
    if (!editorHost.current || !document) return;
    editor.current?.destroy();
    const view = new EditorView({
      state: createEditorState(
        document.markdown,
        false,
        [
          highlightActiveLine(),
          EditorView.theme({
            "&.cm-focused": {
              outline: "2px solid var(--focus-ring)",
              outlineOffset: "-2px",
            },
            ".cm-content": {
              caretColor: "var(--caret)",
              maxWidth: "780px",
              margin: "0 auto",
              paddingBottom: "42vh",
            },
            ".cm-cursor, .cm-dropCursor": {
              borderLeftColor: "var(--caret)",
              borderLeftWidth: "2px",
            },
            ".cm-activeLine": { backgroundColor: "var(--active-line)" },
            "&.cm-focused .cm-selectionBackground, ::selection": {
              backgroundColor: "var(--selection) !important",
            },
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              draft.current = update.state.doc.toString();
              setSaveState((current) => transitionSaveState(current, "edited"));
              setDocument((current) =>
                current
                  ? {
                      ...current,
                      markdown: draft.current,
                      title: titleFromMarkdown(draft.current, t("desktop.untitledNote")),
                    }
                  : current,
              );
            }
          }),
        ],
        locale,
      ),
      parent: editorHost.current,
    });
    editor.current = view;
    return () => view.destroy();
  }, [document?.id, locale, t]);

  useEffect(() => {
    if (!isTauri) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<{ path: string; fingerprint: FileFingerprint }>("stone://file-changed", (event) => {
      if (
        !disposed &&
        document?.path === event.payload.path &&
        fingerprint?.sha256 !== event.payload.fingerprint.sha256
      ) {
        setExternalChange(true);
      }
    }).then((cleanup) => {
      if (disposed) cleanup();
      else unlisten = cleanup;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [document?.path, fingerprint?.sha256]);

  useEffect(() => {
    const save = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveCurrent();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "n") {
        event.preventDefault();
        void createNote();
      }
    };
    window.addEventListener("keydown", save);
    return () => window.removeEventListener("keydown", save);
  });

  async function createNote() {
    const id = crypto.randomUUID();
    const item = await desktopApi.saveDocument({
      id,
      title: t("desktop.newNoteTitle"),
      markdown: `# ${t("desktop.newNoteTitle")}\n\n`,
    });
    setDocuments((current) => [item, ...current.filter((entry) => entry.id !== item.id)]);
    setSelectedId(item.id);
    setSection("notes");
  }

  async function saveCurrent() {
    if (!document || busy) return;
    setBusy(true);
    setSaveState((current) => transitionSaveState(current, "save_started"));
    setMessage(null);
    try {
      const content = normalizeMarkdown(draft.current);
      if (document.path && fingerprint) {
        const result = await desktopApi.saveLinkedFile(document.path, content, fingerprint.sha256);
        setFingerprint(result.fingerprint);
        setExternalChange(false);
      }
      const saved = await desktopApi.saveDocument({
        id: document.id,
        title: titleFromMarkdown(content, t("desktop.untitledNote")),
        markdown: content,
        path: document.path,
      });
      setDocument(saved);
      setDocuments((current) => current.map((item) => (item.id === saved.id ? saved : item)));
      setMessage(t("desktop.saved"));
      setSaveState((current) => transitionSaveState(current, "save_succeeded"));
    } catch (caught) {
      setMessage(toMessage(caught));
      setSaveState((current) => transitionSaveState(current, "save_failed"));
      if (toMessage(caught).includes("ExternalEditConflict")) setExternalChange(true);
    } finally {
      setBusy(false);
    }
  }

  async function openFile() {
    setBusy(true);
    try {
      const item = await desktopApi.pickMarkdownFile();
      if (item) {
        setDocuments((current) => [item, ...current.filter((entry) => entry.id !== item.id)]);
        setSelectedId(item.id);
        if (item.path) setFingerprint((await desktopApi.loadLinkedFile(item.path)).fingerprint);
      }
    } catch (caught) {
      setMessage(toMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function openFolder() {
    try {
      const folder = await desktopApi.pickFolder();
      if (folder) {
        const indexed = await desktopApi.indexFolder(folder);
        setDocuments(indexed);
        setSelectedId(indexed[0]?.id ?? null);
        await desktopApi.watchFolder(folder);
        setMessage(t("desktop.indexedMarkdown", { count: indexed.length }));
      }
    } catch (caught) {
      setMessage(toMessage(caught));
    }
  }

  async function signOut() {
    await desktopApi.authSignOut();
    onSignedOut();
  }

  async function syncNow() {
    setSyncing(true);
    try {
      const result = await desktopApi.syncNow();
      setMessage(
        result.conflicts > 0
          ? t("desktop.syncConflicts", { count: result.conflicts })
          : t("desktop.syncSummary", { pushed: result.pushed, pulled: result.pulled }),
      );
    } catch (caught) {
      setMessage(toMessage(caught));
    } finally {
      setSyncing(false);
    }
  }

  function openDocument(documentId: string) {
    setSelectedId(documentId);
    setSection("notes");
  }

  const activeLabel =
    section === "notes"
      ? t("tabs.notes")
      : section === "projects"
        ? t("tabs.projects")
        : section === "tasks"
          ? t("tabs.tasks")
          : section === "calendar"
            ? t("tabs.calendar")
            : section === "today"
              ? t("tabs.today")
              : section === "focus"
                ? t("tabs.focus")
                : t("tabs.settings");
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="brand-mark small">S</span>
          <span className="brand-wordmark">Stone</span>
        </div>
        <nav aria-label={t("navigation.main")}>
          <NavButton active={section === "notes"} onClick={() => setSection("notes")} icon="✎">
            {t("tabs.notes")}
          </NavButton>
          <NavButton
            active={section === "projects"}
            onClick={() => setSection("projects")}
            icon="▦"
          >
            {t("tabs.projects")}
          </NavButton>
          <NavButton active={section === "tasks"} onClick={() => setSection("tasks")} icon="✓">
            {t("tabs.tasks")}
          </NavButton>
          <NavButton
            active={section === "calendar"}
            onClick={() => setSection("calendar")}
            icon="□"
          >
            {t("tabs.calendar")}
          </NavButton>
          <NavButton active={section === "today"} onClick={() => setSection("today")} icon="◷">
            {t("tabs.today")}
          </NavButton>
          <NavButton active={section === "focus"} onClick={() => setSection("focus")} icon="◉">
            {t("tabs.focus")}
          </NavButton>
          <NavButton
            active={section === "settings"}
            onClick={() => setSection("settings")}
            icon="⚙"
          >
            {t("tabs.settings")}
          </NavButton>
        </nav>
        <div className="sidebar-bottom">
          <span className="sync-dot" /> {session.email}
        </div>
      </aside>
      <main className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">{t("navigation.workspace").toLocaleUpperCase()}</p>
            <h1>{activeLabel}</h1>
          </div>
          <div className="top-actions">
            <button className="secondary-button" disabled={syncing} onClick={() => void syncNow()}>
              {syncing ? t("desktop.syncing") : t("desktop.sync")}
            </button>
            <button className="secondary-button" onClick={() => void openFolder()}>
              {t("desktop.linkFolder")}
            </button>
            <button className="primary-button compact" onClick={() => void createNote()}>
              + {t("desktop.newNote")}
            </button>
          </div>
        </header>
        {message && (
          <div className="toast" role="status">
            {message}
          </div>
        )}
        {section === "notes" && (
          <div className="notes-layout">
            <section className="document-list" aria-label={t("desktop.notesA11y")}>
              <div className="list-actions">
                <button className="text-button" onClick={() => void openFile()}>
                  {t("desktop.openMarkdown")}
                </button>
                <span>{tp("desktop.noteCount", documents.length)}</span>
              </div>
              {documents.length === 0 ? (
                <EmptyState title={t("desktop.noNotes")} detail={t("desktop.noNotesDetail")} />
              ) : (
                documents.map((item) => (
                  <button
                    className={`document-row ${item.id === selectedId ? "selected" : ""}`}
                    key={item.id}
                    onClick={() => setSelectedId(item.id)}
                  >
                    <strong>{item.title || t("desktop.untitledNote")}</strong>
                    <span>{item.path ?? t("desktop.localNote")}</span>
                  </button>
                ))
              )}
            </section>
            <section className="editor-panel" aria-label={t("desktop.markdownEditorA11y")}>
              {document ? (
                <>
                  <div className="editor-toolbar">
                    <div>
                      <strong>{document.title}</strong>
                      <span className={`save-state save-state-${saveState}`} aria-live="polite">
                        {saveState === "unsaved"
                          ? t("desktop.unsaved")
                          : saveState === "saving"
                            ? t("desktop.saving")
                            : saveState === "error"
                              ? t("desktop.saveFailed")
                              : t("desktop.saved")}
                      </span>
                      {document.path && <span className="path-label">{document.path}</span>}
                    </div>
                    <div className="toolbar-actions">
                      {document.path && (
                        <>
                          <button
                            className="icon-button"
                            title={t("desktop.openWith", { application: "VS Code" })}
                            onClick={() => void desktopApi.openExternal("vscode", document.path!)}
                          >
                            VS Code
                          </button>
                          <button
                            className="icon-button"
                            title={t("desktop.openWith", { application: "Codex" })}
                            onClick={() => void desktopApi.openExternal("codex", document.path!)}
                          >
                            Codex
                          </button>
                        </>
                      )}
                      <button
                        className="primary-button compact"
                        onClick={() => void saveCurrent()}
                        disabled={busy}
                      >
                        {t("desktop.save")}
                      </button>
                    </div>
                  </div>
                  {externalChange && (
                    <div className="conflict-banner" role="alert">
                      {t("desktop.externalChange")}
                    </div>
                  )}
                  <div className="editor-host" ref={editorHost} />
                </>
              ) : (
                <EmptyState
                  title={t("desktop.selectNote")}
                  detail={t("desktop.selectNoteDetail")}
                />
              )}
            </section>
          </div>
        )}
        {section === "projects" && (
          <section className="projects-workspace">
            <div className="project-intro">
              <p className="eyebrow">{t("desktop.projectHubEyebrow")}</p>
              <h2>{t("desktop.projectHubTitle")}</h2>
              <p className="muted">{t("desktop.projectHubDetail")}</p>
              <ProjectOverview projects={projects} onOpen={openDocument} />
            </div>
            <GithubPanel />
          </section>
        )}
        {section === "tasks" && (
          <TaskPlanner
            tasks={tasks}
            projects={projects}
            onChange={setTasks}
            onMessage={setMessage}
          />
        )}
        {section === "calendar" && (
          <CalendarWorkspace
            items={calendarItems}
            tasks={tasks}
            projects={projects}
            documents={documents}
            onChange={setCalendarItems}
            onMessage={setMessage}
          />
        )}
        {section === "today" && (
          <TodayOverview
            items={todayItems}
            tasks={tasks}
            calendarItems={calendarItems}
            recentNotes={recentNotes}
            onOpen={openDocument}
            onOpenTasks={() => setSection("tasks")}
          />
        )}
        {section === "focus" && <FocusPanel ownerId={session.uid} />}
        {section === "settings" && (
          <section className="settings-panel">
            <div className="settings-card">
              <h2>{t("locale.setting")}</h2>
              <p className="muted">
                {t("locale.description")} {t("locale.persistence")}
              </p>
              <label>
                {t("locale.setting")}
                <select
                  value={localePreference}
                  onChange={(event) =>
                    setLocalePreference(event.target.value as "system" | "en" | "tr")
                  }
                >
                  <option value="system">{t("locale.system")}</option>
                  <option value="en">{t("locale.english")}</option>
                  <option value="tr">{t("locale.turkish")}</option>
                </select>
              </label>
            </div>
            <div className="settings-card">
              <h2>{t("settings.appearance")}</h2>
              <label>
                {t("settings.theme")}
                <select value={theme} onChange={(event) => setTheme(event.target.value as Theme)}>
                  <option value="system">{t("settings.theme.system")}</option>
                  <option value="light">{t("settings.theme.light")}</option>
                  <option value="dark">{t("settings.theme.dark")}</option>
                </select>
              </label>
              <p className="muted">{t("desktop.shortcuts")}</p>
            </div>
            <div className="settings-card">
              <h2>{t("desktop.account")}</h2>
              <p className="muted">{session.email}</p>
              <button className="secondary-button" onClick={() => void signOut()}>
                {t("desktop.signOut")}
              </button>
            </div>
            <GithubPanel />
          </section>
        )}
      </main>
    </div>
  );
}

function NavButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: string;
  children: string;
}) {
  return (
    <button className={`nav-button ${active ? "active" : ""}`} onClick={onClick}>
      <span aria-hidden="true">{icon}</span>
      {children}
    </button>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">·</div>
      <h2 className="brand-heading">{title}</h2>
      <p>{detail}</p>
    </div>
  );
}

function TaskPlanner({
  tasks,
  projects,
  onChange,
  onMessage,
}: {
  tasks: readonly DesktopTask[];
  projects: readonly DesktopProjectSummary[];
  onChange: (tasks: DesktopTask[]) => void;
  onMessage: (message: string | null) => void;
}) {
  const { locale, t, tp } = useI18n();
  const [title, setTitle] = useState("");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"all" | "today" | "upcoming" | "overdue" | "completed">("today");
  const [selected, setSelected] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const visible = tasks.filter((task) => {
    if (
      query &&
      !`${task.title} ${task.description ?? ""} ${task.tags.join(" ")}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase())
    )
      return false;
    if (view === "completed") return task.state === "completed";
    if (task.state !== "open") return false;
    if (view === "today") return task.dueDate === today;
    if (view === "overdue") return Boolean(task.dueDate && task.dueDate < today);
    if (view === "upcoming") return Boolean(task.dueDate && task.dueDate > today);
    return true;
  });
  const current = tasks.find((task) => task.id === selected) ?? null;

  async function save(task: DesktopTask) {
    try {
      const saved = await desktopApi.saveTask(task);
      onChange([saved, ...tasks.filter((item) => item.id !== saved.id)]);
      setSelected(saved.id);
      onMessage(t("desktop.taskSavedLocally"));
    } catch (caught) {
      onMessage(toMessage(caught));
    }
  }

  async function add() {
    if (!title.trim()) return;
    const timestamp = new Date().toISOString();
    await save({
      schemaVersion: 1,
      id: crypto.randomUUID(),
      title: title.trim(),
      description: null,
      state: "open",
      completedAt: null,
      dueDate: view === "today" ? today : null,
      dueTime: null,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      priority: "none",
      sortOrder: Date.now(),
      tags: [],
      projectId: null,
      parentTaskId: null,
      estimatedMinutes: null,
      recurrence: null,
      sourceDocumentId: null,
      sourceBlockId: null,
      recurrenceSeriesId: null,
      occurrenceDate: null,
      revision: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null,
    });
    setTitle("");
  }

  return (
    <section className="task-workspace" aria-labelledby="task-heading">
      <div className="task-list-panel">
        <div className="task-heading">
          <div>
            <p className="eyebrow">{t("desktop.planningEyebrow")}</p>
            <h2 id="task-heading">{t("tabs.tasks")}</h2>
          </div>
          <span>{tp("desktop.taskCount", visible.length)}</span>
        </div>
        <form
          className="task-quick-add"
          onSubmit={(event) => {
            event.preventDefault();
            void add();
          }}
        >
          <label>
            {t("tasks.quickAdd")}
            <input value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <button className="primary-button compact" disabled={!title.trim()}>
            {t("tasks.add")}
          </button>
        </form>
        <label>
          {t("tasks.search")}
          <input value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
        <div className="task-filters" role="toolbar" aria-label={t("desktop.taskViewsA11y")}>
          {(["all", "today", "upcoming", "overdue", "completed"] as const).map((item) => (
            <button
              key={item}
              className={view === item ? "selected" : ""}
              aria-pressed={view === item}
              onClick={() => setView(item)}
            >
              {t(
                item === "all"
                  ? "tasks.all"
                  : item === "today"
                    ? "tasks.today"
                    : item === "upcoming"
                      ? "tasks.upcoming"
                      : item === "overdue"
                        ? "tasks.overdue"
                        : "tasks.completed",
              )}
            </button>
          ))}
        </div>
        <div className="task-list" role="list">
          {visible.length === 0 ? (
            <EmptyState title={t("tasks.emptyFilter")} detail={t("tasks.emptyFilterDetail")} />
          ) : (
            visible.map((task) => (
              <div
                className={`task-list-row ${selected === task.id ? "selected" : ""}`}
                key={task.id}
              >
                <button
                  className="task-checkbox"
                  role="checkbox"
                  aria-checked={task.state === "completed"}
                  aria-label={t("tasks.toggleA11y", {
                    title: task.title,
                    action: t(
                      task.state === "completed" ? "a11y.task.reopen" : "a11y.task.complete",
                    ),
                  })}
                  onClick={() =>
                    void save({
                      ...task,
                      state: task.state === "completed" ? "open" : "completed",
                      completedAt: task.state === "completed" ? null : new Date().toISOString(),
                    })
                  }
                >
                  {task.state === "completed" ? "✓" : ""}
                </button>
                <button className="task-open" onClick={() => setSelected(task.id)}>
                  <strong>{task.title}</strong>
                  <span>
                    {task.priority !== "none"
                      ? `${formatTaskPriority(locale, task.priority)} · `
                      : ""}
                    {task.dueDate ?? t("tasks.noDate")}
                  </span>
                </button>
              </div>
            ))
          )}
        </div>
      </div>
      <TaskEditor
        task={current}
        projects={projects}
        onSave={(task) => void save(task)}
        onDelete={(task) =>
          void desktopApi
            .deleteTask(task.id)
            .then(() => {
              onChange(tasks.filter((item) => item.id !== task.id));
              setSelected(null);
            })
            .catch((caught) => onMessage(toMessage(caught)))
        }
      />
    </section>
  );
}

function TaskEditor({
  task,
  projects,
  onSave,
  onDelete,
}: {
  task: DesktopTask | null;
  projects: readonly DesktopProjectSummary[];
  onSave: (task: DesktopTask) => void;
  onDelete: (task: DesktopTask) => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<DesktopTask | null>(task);
  useEffect(() => setDraft(task), [task]);
  if (!draft)
    return (
      <aside className="task-editor">
        <EmptyState title={t("desktop.selectTask")} detail={t("desktop.selectTaskDetail")} />
      </aside>
    );
  return (
    <aside className="task-editor" aria-label={t("desktop.taskDetails")}>
      <h2>{t("desktop.taskDetails")}</h2>
      <label>
        {t("tasks.titleField")}
        <input
          value={draft.title}
          onChange={(event) => setDraft({ ...draft, title: event.target.value })}
        />
      </label>
      <label>
        {t("tasks.description")}
        <textarea
          value={draft.description ?? ""}
          onChange={(event) => setDraft({ ...draft, description: event.target.value || null })}
        />
      </label>
      <div className="task-editor-grid">
        <label>
          {t("desktop.date")}
          <input
            type="date"
            value={draft.dueDate ?? ""}
            onChange={(event) => setDraft({ ...draft, dueDate: event.target.value || null })}
          />
        </label>
        <label>
          {t("desktop.time")}
          <input
            type="time"
            value={draft.dueTime ?? ""}
            onChange={(event) => setDraft({ ...draft, dueTime: event.target.value || null })}
          />
        </label>
      </div>
      <label>
        {t("tasks.priority")}
        <select
          value={draft.priority}
          onChange={(event) =>
            setDraft({ ...draft, priority: event.target.value as DesktopTask["priority"] })
          }
        >
          <option value="none">{t("desktop.noPriority")}</option>
          <option value="low">{t("tasks.priority.low")}</option>
          <option value="medium">{t("tasks.priority.medium")}</option>
          <option value="high">{t("tasks.priority.high")}</option>
        </select>
      </label>
      <label>
        {t("calendar.project")}
        <select
          value={draft.projectId ?? ""}
          onChange={(event) => setDraft({ ...draft, projectId: event.target.value || null })}
        >
          <option value="">{t("calendar.noProject")}</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.title}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t("desktop.tags")}
        <input
          value={draft.tags.join(", ")}
          onChange={(event) =>
            setDraft({
              ...draft,
              tags: event.target.value
                .split(",")
                .map((tag) => tag.trim())
                .filter(Boolean),
            })
          }
        />
      </label>
      <label>
        {t("desktop.estimatedMinutes")}
        <input
          type="number"
          min="1"
          value={draft.estimatedMinutes ?? ""}
          onChange={(event) =>
            setDraft({
              ...draft,
              estimatedMinutes: event.target.value ? Number(event.target.value) : null,
            })
          }
        />
      </label>
      <p className="muted">{t("tasks.timeNoNotification")}</p>
      <div className="task-editor-actions">
        <button
          className="primary-button"
          disabled={!draft.title.trim()}
          onClick={() => onSave(draft)}
        >
          {t("desktop.save")}
        </button>
        <button className="secondary-button" onClick={() => onDelete(draft)}>
          {t("desktop.delete")}
        </button>
      </div>
    </aside>
  );
}

function ProjectOverview({
  projects,
  onOpen,
}: {
  projects: readonly DesktopProjectSummary[];
  onOpen: (documentId: string) => void;
}) {
  const { locale, t, tp } = useI18n();
  if (projects.length === 0)
    return (
      <div className="inline-empty">
        <strong>{t("desktop.noProjectDocuments")}</strong>
        <span>{t("desktop.noProjectDocumentsDetail")}</span>
      </div>
    );
  return (
    <div className="project-summary-grid">
      {projects.map((project) => (
        <button
          className="project-summary-card"
          key={project.id}
          onClick={() => onOpen(project.documentId)}
        >
          <div className="project-card-heading">
            <strong>{project.title}</strong>
            <span className="status-badge">{formatProjectStatus(locale, project.status)}</span>
          </div>
          <span>
            {t("projects.tasksProgress", {
              completed: project.completedTasks,
              total: project.totalTasks,
            })}{" "}
            · {formatProjectPriority(locale, project.priority)}
          </span>
          <progress
            max={Math.max(1, project.totalTasks)}
            value={project.completedTasks}
            aria-label={t("desktop.projectProgressA11y", { title: project.title })}
          />
          <span>
            {project.currentVersion ?? t("desktop.currentVersionMissing")} →{" "}
            {project.nextVersion ?? t("desktop.nextVersionMissing")}
          </span>
          <span>{project.nextAction ?? t("desktop.nextActionMissing")}</span>
          <span>
            {project.blockers.length > 0
              ? tp("desktop.openBlockerCount", project.blockers.length)
              : t("desktop.noOpenBlockers")}
            {project.versions.length > 0
              ? ` · ${tp("desktop.versionCount", project.versions.length)}`
              : ""}
          </span>
        </button>
      ))}
    </div>
  );
}

function CalendarWorkspace({
  items,
  tasks,
  projects,
  documents,
  onChange,
  onMessage,
}: {
  items: readonly CalendarItem[];
  tasks: readonly DesktopTask[];
  projects: readonly DesktopProjectSummary[];
  documents: readonly DesktopDocument[];
  onChange: (items: CalendarItem[]) => void;
  onMessage: (message: string) => void;
}) {
  const { t } = useI18n();
  const [view, setView] = useState<"month" | "week" | "day" | "agenda">("week");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [allDay, setAllDay] = useState(false);
  const [eventEndDate, setEventEndDate] = useState("");
  const [eventTimezone, setEventTimezone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  );
  const [eventCategory, setEventCategory] = useState<CalendarItem["category"]>("purple");
  const [eventProjectId, setEventProjectId] = useState("");
  const [eventSourceDocumentId, setEventSourceDocumentId] = useState("");
  const [recurrenceFrequency, setRecurrenceFrequency] = useState<
    "" | "daily" | "weekdays" | "weekly" | "monthly"
  >("");
  const [recurrenceUntilDate, setRecurrenceUntilDate] = useState("");
  const [taskId, setTaskId] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [selectedOccurrenceDate, setSelectedOccurrenceDate] = useState<string | null>(null);
  const [recurrenceScope, setRecurrenceScope] = useState<CalendarRecurrenceEditScope>("occurrence");
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editPlanningNote, setEditPlanningNote] = useState("");
  const [editLocation, setEditLocation] = useState("");
  const [editAllDay, setEditAllDay] = useState(false);
  const [editStartDate, setEditStartDate] = useState("");
  const [editEndDate, setEditEndDate] = useState("");
  const [editStartTime, setEditStartTime] = useState("09:00");
  const [editEndTime, setEditEndTime] = useState("10:00");
  const [editTimezone, setEditTimezone] = useState("UTC");
  const [editCategory, setEditCategory] = useState<CalendarItem["category"]>("purple");
  const [editProjectId, setEditProjectId] = useState("");
  const [editSourceDocumentId, setEditSourceDocumentId] = useState("");
  const [search, setSearch] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [kindFilter, setKindFilter] = useState<"" | CalendarItem["kind"]>("");
  const [categoryFilter, setCategoryFilter] = useState<"" | CalendarItem["category"]>("");
  const [completionFilter, setCompletionFilter] = useState<"" | "open" | "completed">("");
  const today = new Date().toISOString().slice(0, 10);
  const days =
    view === "month" ? monthGrid(date, today) : view === "week" ? weekDates(date) : [date];
  const firstDay = days[0];
  const rangeStart = typeof firstDay === "string" ? firstDay : (firstDay?.date ?? date);
  const lastDay = days.at(-1);
  const rangeEnd = typeof lastDay === "string" ? lastDay : (lastDay?.date ?? date);
  const expanded = items.flatMap((item) =>
    item.deletedAt
      ? []
      : expandCalendarOccurrences(item, rangeStart, rangeEnd).map((occurrence) => occurrence.item),
  );
  const visible = [
    ...filterCalendarItems(
      expanded,
      {
        startDate: rangeStart,
        endDate: rangeEnd,
        ...(projectFilter ? { projectId: projectFilter } : {}),
        ...(kindFilter ? { kind: kindFilter } : {}),
        ...(categoryFilter ? { category: categoryFilter } : {}),
        ...(completionFilter ? { taskState: completionFilter } : {}),
        ...(search ? { search } : {}),
      },
      new Map(tasks.map((task) => [task.id, task.state])),
    ),
  ].sort(
    (left, right) =>
      left.startDate.localeCompare(right.startDate) ||
      (left.startAt ?? "").localeCompare(right.startAt ?? ""),
  );
  const visibleIds = new Set(visible.map((item) => item.id));
  const agendaItems = buildAgendaItems(
    items,
    tasks,
    projects.map((project) => ({
      id: project.id,
      title: project.title,
      targetDate: project.targetDate,
      canonicalDocumentId: project.documentId,
      deletedAt: null,
    })),
    rangeStart,
    rangeEnd,
  ).filter((item) => {
    if (item.calendarItemId && !visibleIds.has(item.calendarItemId)) return false;
    if (projectFilter && item.projectId !== projectFilter) return false;
    if (kindFilter && item.kind !== kindFilter) return false;
    if (completionFilter && item.completed !== (completionFilter === "completed")) return false;
    return !search || item.title.toLocaleLowerCase().includes(search.toLocaleLowerCase());
  });
  const selectedItem = items.find((item) => item.id === selectedItemId) ?? null;
  const displayedSelectedItem =
    selectedItem && selectedOccurrenceDate
      ? (expandCalendarOccurrences(selectedItem, selectedOccurrenceDate, selectedOccurrenceDate)[0]
          ?.item ?? selectedItem)
      : selectedItem;
  const editsOccurrenceOnly =
    Boolean(selectedItem?.recurrence) &&
    Boolean(selectedOccurrenceDate) &&
    recurrenceScope === "occurrence";
  const hasUnsavedCalendarEdits =
    Boolean(displayedSelectedItem) &&
    JSON.stringify({
      title: editTitle,
      description: editDescription,
      planningNote: editPlanningNote,
      location: editLocation,
      allDay: editAllDay,
      startDate: editStartDate,
      endDate: editEndDate,
      startTime: editStartTime,
      endTime: editEndTime,
      timezone: editTimezone,
      category: editCategory,
      projectId: editProjectId,
      sourceDocumentId: editSourceDocumentId,
    }) !==
      JSON.stringify({
        title: displayedSelectedItem?.title ?? "",
        description: displayedSelectedItem?.description ?? "",
        planningNote: displayedSelectedItem?.planningNote ?? "",
        location: displayedSelectedItem?.location ?? "",
        allDay: displayedSelectedItem?.allDay ?? false,
        startDate: displayedSelectedItem?.startDate ?? "",
        endDate: displayedSelectedItem?.endDate ?? "",
        startTime: displayedSelectedItem?.startAt
          ? instantToZonedWallTime(
              displayedSelectedItem.startAt,
              displayedSelectedItem.timezone,
            ).slice(11, 16)
          : "09:00",
        endTime: displayedSelectedItem?.endAt
          ? instantToZonedWallTime(
              displayedSelectedItem.endAt,
              displayedSelectedItem.timezone,
            ).slice(11, 16)
          : "10:00",
        timezone: displayedSelectedItem?.timezone ?? "UTC",
        category: displayedSelectedItem?.category ?? "purple",
        projectId: displayedSelectedItem?.projectId ?? "",
        sourceDocumentId: displayedSelectedItem?.sourceDocumentId ?? "",
      });
  useEffect(() => {
    const displayed = displayedSelectedItem;
    setEditTitle(displayed?.title ?? "");
    setEditDescription(displayed?.description ?? "");
    setEditPlanningNote(displayed?.planningNote ?? "");
    setEditLocation(displayed?.location ?? "");
    setEditAllDay(displayed?.allDay ?? false);
    setEditStartDate(displayed?.startDate ?? "");
    setEditEndDate(displayed?.endDate ?? "");
    setEditTimezone(displayed?.timezone ?? "UTC");
    setEditCategory(displayed?.category ?? "purple");
    setEditProjectId(displayed?.projectId ?? "");
    setEditSourceDocumentId(displayed?.sourceDocumentId ?? "");
    if (displayed?.startAt)
      setEditStartTime(instantToZonedWallTime(displayed.startAt, displayed.timezone).slice(11, 16));
    else setEditStartTime("09:00");
    if (displayed?.endAt)
      setEditEndTime(instantToZonedWallTime(displayed.endAt, displayed.timezone).slice(11, 16));
    else setEditEndTime("10:00");
  }, [selectedItem, selectedOccurrenceDate]);

  function openCalendarItem(
    itemId: string,
    occurrenceDate?: string | null,
    discardUnsaved = false,
  ) {
    if (
      !discardUnsaved &&
      hasUnsavedCalendarEdits &&
      !window.confirm(t("desktop.discardCalendarChanges"))
    )
      return;
    setSelectedItemId(itemId);
    setSelectedOccurrenceDate(occurrenceDate ?? null);
    setRecurrenceScope("occurrence");
  }

  useEffect(() => {
    void desktopApi
      .listCalendarItems(rangeStart, rangeEnd)
      .then(onChange)
      .catch((caught) => onMessage(toMessage(caught)));
  }, [onChange, onMessage, rangeEnd, rangeStart]);

  async function create(input?: { taskId?: string; date?: string; startTime?: string }) {
    const selectedTaskId = input?.taskId ?? taskId;
    if (!title.trim() && !selectedTaskId) return;
    const now = new Date().toISOString();
    const itemId = crypto.randomUUID();
    const task = tasks.find((value) => value.id === selectedTaskId);
    const timezone = eventTimezone;
    const scheduledDate = input?.date ?? date;
    const scheduledEndDate = task ? scheduledDate : eventEndDate || scheduledDate;
    const scheduledStart = input?.startTime ?? startTime;
    const startMinute = Number(scheduledStart.slice(0, 2)) * 60 + Number(scheduledStart.slice(3));
    const duration = task?.estimatedMinutes ?? 60;
    const endMinute = Math.min(startMinute + duration, 23 * 60 + 59);
    const scheduledEnd = `${String(Math.floor(endMinute / 60)).padStart(2, "0")}:${String(endMinute % 60).padStart(2, "0")}`;
    const item: CalendarItem = {
      schemaVersion: 1,
      id: itemId,
      ownerId: "",
      revision: 0,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      updatedByDeviceId: "",
      kind: task ? "task_block" : "event",
      title: task?.title ?? title.trim(),
      description: task ? null : description.trim() || null,
      allDay: task ? false : allDay,
      startDate: scheduledDate,
      endDate: scheduledEndDate,
      startAt:
        !task && allDay
          ? null
          : zonedWallTimeToInstant(scheduledDate, scheduledStart, timezone, "earlier"),
      endAt:
        !task && allDay
          ? null
          : zonedWallTimeToInstant(
              scheduledEndDate,
              task ? scheduledEnd : endTime,
              timezone,
              "later",
            ),
      timezone,
      location: task ? null : location.trim() || null,
      category: task ? "blue" : eventCategory,
      projectId: task?.projectId ?? (eventProjectId || null),
      sourceDocumentId: task?.sourceDocumentId ?? (eventSourceDocumentId || null),
      taskId: task?.id ?? null,
      planningNote: null,
      recurrence:
        !task && recurrenceFrequency
          ? {
              frequency: recurrenceFrequency,
              interval: 1,
              unit:
                recurrenceFrequency === "monthly"
                  ? "month"
                  : recurrenceFrequency === "weekly"
                    ? "week"
                    : "day",
              preferredDayOfMonth:
                recurrenceFrequency === "monthly" ? Number(scheduledDate.slice(8)) : null,
              untilDate: recurrenceUntilDate || null,
            }
          : null,
      recurrenceSeriesId: !task && recurrenceFrequency ? itemId : null,
      recurrenceId: null,
      overrides: [],
      externalUid: null,
      cancelledAt: null,
    };
    try {
      const saved = await desktopApi.saveCalendarItem(item);
      onChange([...items, saved]);
      setTitle("");
      setDescription("");
      setLocation("");
      setTaskId("");
      onMessage(task ? t("desktop.taskBlockScheduled") : t("desktop.calendarRecordSaved"));
    } catch (caught) {
      onMessage(toMessage(caught));
    }
  }
  async function moveOrResize(item: CalendarItem, startDelta: number, endDelta: number) {
    if (!item.startAt || !item.endAt) return;
    try {
      const shifted = shiftTimedCalendarItem(item, startDelta, endDelta);
      const source = items.find((value) => value.id === item.id) ?? item;
      const next =
        source.recurrence && item.recurrenceId
          ? editCalendarRecurrence(
              source,
              item.recurrenceId,
              "occurrence",
              { startAt: shifted.startAt, endAt: shifted.endAt },
              crypto.randomUUID(),
            ).current
          : { ...source, ...shifted };
      const saved = await desktopApi.saveCalendarItem(next);
      onChange(items.map((value) => (value.id === saved.id ? saved : value)));
      onMessage(
        source.recurrence && item.recurrenceId
          ? t("desktop.occurrenceUpdated")
          : t("desktop.calendarRecordUpdated"),
      );
    } catch (caught) {
      onMessage(toMessage(caught));
    }
  }
  async function moveToSlot(
    itemId: string,
    occurrenceDate: string | null,
    targetDate: string,
    targetTime: string,
  ) {
    const source = items.find((value) => value.id === itemId);
    const item =
      source && occurrenceDate
        ? expandCalendarOccurrences(source, occurrenceDate, occurrenceDate)[0]?.item
        : source;
    if (!source || !item?.startAt || !item.endAt) return;
    try {
      const moved = moveTimedCalendarItemToSlot(item, targetDate, targetTime);
      const next =
        source.recurrence && occurrenceDate
          ? editCalendarRecurrence(
              source,
              occurrenceDate,
              "occurrence",
              {
                startDate: moved.startDate,
                endDate: moved.endDate,
                startAt: moved.startAt,
                endAt: moved.endAt,
              },
              crypto.randomUUID(),
            ).current
          : { ...source, ...moved };
      const saved = await desktopApi.saveCalendarItem(next);
      onChange(items.map((value) => (value.id === saved.id ? saved : value)));
      onMessage(t("desktop.calendarRecordMoved"));
    } catch (caught) {
      onMessage(toMessage(caught));
    }
  }
  async function saveSelected() {
    if (!selectedItem || !editTitle.trim()) return;
    try {
      const timedChanges = editAllDay
        ? { startAt: null, endAt: null }
        : {
            startAt: zonedWallTimeToInstant(editStartDate, editStartTime, editTimezone, "earlier"),
            endAt: zonedWallTimeToInstant(editEndDate, editEndTime, editTimezone, "later"),
          };
      const occurrenceChanges = {
        title: editTitle.trim(),
        description: editDescription.trim() || null,
        location: editLocation.trim() || null,
        startDate: editStartDate,
        endDate: editEndDate,
        category: editCategory,
        ...timedChanges,
      };
      const mutation =
        selectedItem.recurrence && selectedOccurrenceDate
          ? editCalendarRecurrence(
              selectedItem,
              selectedOccurrenceDate,
              recurrenceScope,
              occurrenceChanges,
              crypto.randomUUID(),
            )
          : {
              current: {
                ...selectedItem,
                ...occurrenceChanges,
                allDay: editAllDay,
                timezone: editTimezone,
                projectId: editProjectId || null,
                sourceDocumentId: editSourceDocumentId || null,
                planningNote: editPlanningNote.trim() || null,
              },
              future: null,
            };
      if (selectedItem.recurrence && recurrenceScope !== "occurrence") {
        const target = recurrenceScope === "future" ? mutation.future : mutation.current;
        if (target) {
          Object.assign(target, {
            allDay: editAllDay,
            timezone: editTimezone,
            projectId: editProjectId || null,
            sourceDocumentId: editSourceDocumentId || null,
            planningNote: editPlanningNote.trim() || null,
          });
        }
      }
      const future = mutation.future ? await desktopApi.saveCalendarItem(mutation.future) : null;
      const saved = await desktopApi.saveCalendarItem(mutation.current);
      onChange([
        ...items.map((item) => (item.id === saved.id ? saved : item)),
        ...(future ? [future] : []),
      ]);
      if (future) openCalendarItem(future.id, future.startDate, true);
      onMessage(t("desktop.eventDetailsSaved"));
    } catch (caught) {
      onMessage(toMessage(caught));
    }
  }
  async function duplicateSelected() {
    if (!selectedItem) return;
    const now = new Date().toISOString();
    try {
      const saved = await desktopApi.saveCalendarItem({
        ...selectedItem,
        id: crypto.randomUUID(),
        revision: 0,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        cancelledAt: null,
        recurrenceSeriesId: null,
        recurrenceId: null,
      });
      onChange([...items, saved]);
      openCalendarItem(saved.id, null, true);
      onMessage(t("desktop.calendarRecordDuplicated"));
    } catch (caught) {
      onMessage(toMessage(caught));
    }
  }
  async function deleteSelected() {
    if (!selectedItem) return;
    try {
      if (selectedItem.recurrence && selectedOccurrenceDate) {
        const mutation = deleteCalendarRecurrence(
          selectedItem,
          selectedOccurrenceDate,
          recurrenceScope,
          new Date().toISOString(),
          crypto.randomUUID(),
        );
        const future = mutation.future ? await desktopApi.saveCalendarItem(mutation.future) : null;
        const current = await desktopApi.saveCalendarItem(mutation.current);
        onChange([
          ...items.map((item) => (item.id === current.id ? current : item)),
          ...(future ? [future] : []),
        ]);
      } else {
        const deleted = await desktopApi.deleteCalendarItem(selectedItem.id);
        onChange(items.map((item) => (item.id === deleted.id ? deleted : item)));
      }
      setSelectedItemId(null);
      setSelectedOccurrenceDate(null);
      onMessage(
        selectedItem.kind === "task_block"
          ? t("desktop.taskBlockRemoved")
          : t("desktop.eventDeleted"),
      );
    } catch (caught) {
      onMessage(toMessage(caught));
    }
  }
  async function importIcs() {
    try {
      const source = await desktopApi.pickCalendarFile();
      if (source === null) return;
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      const parsed = importCalendarIcs(source, {
        ownerId: "",
        deviceId: "",
        now: new Date().toISOString(),
        timezone,
      });
      const existing = await desktopApi.listCalendarItemsForExport();
      const existingIds = new Set(existing.map((item) => item.id));
      const fresh = parsed.filter((item) => !existingIds.has(item.id));
      if (
        parsed.length >= 100 &&
        !window.confirm(
          t("desktop.icsImportConfirm", {
            fresh: fresh.length,
            duplicates: parsed.length - fresh.length,
          }),
        )
      )
        return;
      for (const item of fresh) await desktopApi.saveCalendarItem(item);
      onChange(await desktopApi.listCalendarItems(rangeStart, rangeEnd));
      onMessage(
        t("desktop.icsImportSummary", {
          fresh: fresh.length,
          duplicates: parsed.length - fresh.length,
        }),
      );
    } catch (caught) {
      onMessage(toMessage(caught));
    }
  }
  async function exportIcs() {
    try {
      const exported = exportCalendarIcs(await desktopApi.listCalendarItemsForExport());
      const saved = await desktopApi.saveCalendarFile(exported);
      if (saved) onMessage(t("desktop.icsExported"));
    } catch (caught) {
      onMessage(toMessage(caught));
    }
  }
  function shift(days: number) {
    const value = new Date(`${date}T00:00:00Z`);
    value.setUTCDate(value.getUTCDate() + days);
    setDate(value.toISOString().slice(0, 10));
  }
  function shiftPeriod(direction: -1 | 1) {
    if (view === "month") {
      const value = new Date(`${date.slice(0, 8)}01T00:00:00Z`);
      value.setUTCMonth(value.getUTCMonth() + direction);
      setDate(value.toISOString().slice(0, 10));
    } else shift(direction * (view === "week" ? 7 : 1));
  }
  return (
    <section className="calendar-workspace" aria-label={t("tabs.calendar")}>
      <div className="calendar-toolbar">
        <div className="segmented" role="group" aria-label={t("desktop.calendarViewA11y")}>
          {(["month", "week", "day", "agenda"] as const).map((value) => (
            <button key={value} aria-pressed={view === value} onClick={() => setView(value)}>
              {t(`desktop.view.${value}`)}
            </button>
          ))}
        </div>
        <button onClick={() => shiftPeriod(-1)}>{t("desktop.previous")}</button>
        <button onClick={() => setDate(new Date().toISOString().slice(0, 10))}>
          {t("tasks.today")}
        </button>
        <input
          aria-label={t("desktop.goToDate")}
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
        />
        <button onClick={() => shiftPeriod(1)}>{t("desktop.next")}</button>
        <button onClick={() => void importIcs()}>{t("calendar.importIcs")}</button>
        <button onClick={() => void exportIcs()}>{t("calendar.exportIcs")}</button>
      </div>
      <div className="calendar-grid">
        <div className="calendar-create">
          <h2>{date}</h2>
          <p className="muted">
            {t("desktop.hoursTimezone", {
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            })}
          </p>
          <label>
            {t("calendar.titleField")}
            <input value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label>
            {t("calendar.description")}
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          <label>
            {t("calendar.location")}
            <input value={location} onChange={(event) => setLocation(event.target.value)} />
          </label>
          <label className="calendar-checkbox">
            <input
              type="checkbox"
              checked={allDay}
              onChange={(event) => setAllDay(event.target.checked)}
            />
            {t("calendar.allDay")}
          </label>
          <label>
            {t("desktop.endDate")}
            <input
              type="date"
              min={date}
              value={eventEndDate || date}
              onChange={(event) => setEventEndDate(event.target.value)}
            />
          </label>
          <label>
            {t("calendar.timezone")}
            <input
              value={eventTimezone}
              onChange={(event) => setEventTimezone(event.target.value)}
            />
          </label>
          <label>
            {t("calendar.category")}
            <select
              value={eventCategory}
              onChange={(event) => setEventCategory(event.target.value as CalendarItem["category"])}
            >
              {(["neutral", "purple", "blue", "green", "amber", "red"] as const).map((category) => (
                <option key={category}>{t(`calendar.category.${category}`)}</option>
              ))}
            </select>
          </label>
          <label>
            {t("calendar.project")}
            <select
              value={eventProjectId}
              onChange={(event) => setEventProjectId(event.target.value)}
            >
              <option value="">{t("calendar.noProject")}</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("calendar.sourceNote")}
            <select
              value={eventSourceDocumentId}
              onChange={(event) => setEventSourceDocumentId(event.target.value)}
            >
              <option value="">{t("desktop.noSourceNote")}</option>
              {documents.slice(0, 200).map((document) => (
                <option key={document.id} value={document.id}>
                  {document.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("calendar.recurrence")}
            <select
              value={recurrenceFrequency}
              onChange={(event) =>
                setRecurrenceFrequency(
                  event.target.value as "" | "daily" | "weekdays" | "weekly" | "monthly",
                )
              }
            >
              <option value="">{t("recurrence.none")}</option>
              <option value="daily">{t("desktop.repeat.daily")}</option>
              <option value="weekdays">{t("desktop.repeat.weekdays")}</option>
              <option value="weekly">{t("desktop.repeat.weekly")}</option>
              <option value="monthly">{t("desktop.repeat.monthly")}</option>
            </select>
          </label>
          {recurrenceFrequency ? (
            <label>
              {t("desktop.repeatEnd")}
              <input
                type="date"
                min={date}
                value={recurrenceUntilDate}
                onChange={(event) => setRecurrenceUntilDate(event.target.value)}
              />
            </label>
          ) : null}
          <label>
            {t("desktop.orScheduleTask")}
            <select value={taskId} onChange={(event) => setTaskId(event.target.value)}>
              <option value="">{t("desktop.noTaskSelected")}</option>
              {tasks
                .filter((task) => task.state === "open" && !task.deletedAt)
                .map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.title}
                  </option>
                ))}
            </select>
            <div className="draggable-tasks" aria-label={t("desktop.draggableTasksA11y")}>
              {tasks
                .filter((task) => task.state === "open" && !task.deletedAt)
                .slice(0, 30)
                .map((task) => (
                  <button
                    key={task.id}
                    draggable
                    onDragStart={(event) => event.dataTransfer.setData("text/stone-task", task.id)}
                    onClick={() => setTaskId(task.id)}
                  >
                    {task.title}
                  </button>
                ))}
            </div>
          </label>
          {!allDay || taskId ? (
            <div className="time-fields">
              <label>
                {t("calendar.start")}
                <input
                  type="time"
                  value={startTime}
                  onChange={(event) => setStartTime(event.target.value)}
                />
              </label>
              <label>
                {t("calendar.end")}
                <input
                  type="time"
                  value={endTime}
                  onChange={(event) => setEndTime(event.target.value)}
                />
              </label>
            </div>
          ) : null}
          <button
            className="primary-button"
            onClick={() => void create()}
            disabled={!title.trim() && !taskId}
          >
            {t("desktop.addToCalendar")}
          </button>
          <p className="hint">{t("desktop.remindersUnavailable")}</p>
          <div className="calendar-filters" aria-label={t("desktop.calendarFiltersA11y")}>
            <label>
              {t("common.search")}
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <label>
              {t("calendar.project")}
              <select
                value={projectFilter}
                onChange={(event) => setProjectFilter(event.target.value)}
              >
                <option value="">{t("desktop.allProjects")}</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("desktop.type")}
              <select
                value={kindFilter}
                onChange={(event) => setKindFilter(event.target.value as "" | CalendarItem["kind"])}
              >
                <option value="">{t("desktop.allTypes")}</option>
                <option value="event">{t("calendar.event")}</option>
                <option value="task_block">{t("calendar.taskBlock")}</option>
              </select>
            </label>
            <label>
              {t("calendar.category")}
              <select
                value={categoryFilter}
                onChange={(event) =>
                  setCategoryFilter(event.target.value as "" | CalendarItem["category"])
                }
              >
                <option value="">{t("desktop.allCategories")}</option>
                {(["neutral", "purple", "blue", "green", "amber", "red"] as const).map(
                  (category) => (
                    <option key={category} value={category}>
                      {t(`calendar.category.${category}`)}
                    </option>
                  ),
                )}
              </select>
            </label>
            <label>
              {t("desktop.taskStatus")}
              <select
                value={completionFilter}
                onChange={(event) =>
                  setCompletionFilter(event.target.value as "" | "open" | "completed")
                }
              >
                <option value="">{t("desktop.allStatuses")}</option>
                <option value="open">{t("tasks.status.open")}</option>
                <option value="completed">{t("tasks.status.completed")}</option>
              </select>
            </label>
          </div>
          {selectedItem ? (
            <div className="calendar-edit-panel">
              <h3>{t("desktop.editSelectedRecord")}</h3>
              <label>
                {t("calendar.titleField")}
                <input value={editTitle} onChange={(event) => setEditTitle(event.target.value)} />
              </label>
              <label>
                {t("calendar.description")}
                <textarea
                  value={editDescription}
                  onChange={(event) => setEditDescription(event.target.value)}
                  disabled={editsOccurrenceOnly}
                />
              </label>
              {editsOccurrenceOnly ? <p>{t("desktop.occurrenceEditLimit")}</p> : null}
              <label>
                {t("calendar.location")}
                <input
                  value={editLocation}
                  onChange={(event) => setEditLocation(event.target.value)}
                  disabled={editsOccurrenceOnly}
                />
              </label>
              <label className="calendar-checkbox">
                <input
                  type="checkbox"
                  checked={editAllDay}
                  onChange={(event) => setEditAllDay(event.target.checked)}
                  disabled={editsOccurrenceOnly}
                />
                {t("calendar.allDay")}
              </label>
              <label>
                {t("calendar.startDate")}
                <input
                  type="date"
                  value={editStartDate}
                  onChange={(event) => setEditStartDate(event.target.value)}
                  disabled={editsOccurrenceOnly}
                />
              </label>
              <label>
                {t("calendar.endDate")}
                <input
                  type="date"
                  value={editEndDate}
                  onChange={(event) => setEditEndDate(event.target.value)}
                  disabled={editsOccurrenceOnly}
                />
              </label>
              {!editAllDay ? (
                <>
                  <label>
                    {t("calendar.startTime")}
                    <input
                      type="time"
                      value={editStartTime}
                      onChange={(event) => setEditStartTime(event.target.value)}
                    />
                  </label>
                  <label>
                    {t("calendar.endTime")}
                    <input
                      type="time"
                      value={editEndTime}
                      onChange={(event) => setEditEndTime(event.target.value)}
                    />
                  </label>
                </>
              ) : null}
              <label>
                {t("calendar.timezone")}
                <input
                  value={editTimezone}
                  onChange={(event) => setEditTimezone(event.target.value)}
                  disabled={editsOccurrenceOnly}
                />
              </label>
              <label>
                {t("calendar.category")}
                <select
                  value={editCategory}
                  onChange={(event) =>
                    setEditCategory(event.target.value as CalendarItem["category"])
                  }
                  disabled={editsOccurrenceOnly}
                >
                  {(["neutral", "purple", "blue", "green", "amber", "red"] as const).map(
                    (category) => (
                      <option key={category} value={category}>
                        {t(`calendar.category.${category}`)}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <label>
                {t("calendar.project")}
                <select
                  value={editProjectId}
                  onChange={(event) => setEditProjectId(event.target.value)}
                  disabled={editsOccurrenceOnly}
                >
                  <option value="">{t("calendar.noProject")}</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.title}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t("calendar.sourceNote")}
                <select
                  value={editSourceDocumentId}
                  onChange={(event) => setEditSourceDocumentId(event.target.value)}
                  disabled={editsOccurrenceOnly}
                >
                  <option value="">{t("calendar.noLink")}</option>
                  {documents.slice(0, 200).map((document) => (
                    <option key={document.id} value={document.id}>
                      {document.title}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t("desktop.planningNote")}
                <textarea
                  value={editPlanningNote}
                  onChange={(event) => setEditPlanningNote(event.target.value)}
                  disabled={editsOccurrenceOnly}
                />
              </label>
              {selectedItem.recurrence && selectedOccurrenceDate ? (
                <label>
                  {t("desktop.repeatScope")}
                  <select
                    value={recurrenceScope}
                    onChange={(event) =>
                      setRecurrenceScope(event.target.value as CalendarRecurrenceEditScope)
                    }
                  >
                    <option value="occurrence">{t("calendar.scope.occurrence")}</option>
                    <option value="future">{t("calendar.scope.future")}</option>
                    <option value="series">{t("calendar.scope.series")}</option>
                  </select>
                </label>
              ) : null}
              <div className="calendar-event-actions">
                <button onClick={() => void saveSelected()}>{t("desktop.save")}</button>
                <button onClick={() => void duplicateSelected()}>{t("desktop.duplicate")}</button>
                <button onClick={() => void deleteSelected()}>
                  {selectedItem.kind === "task_block"
                    ? t("desktop.removeBlock")
                    : t("desktop.delete")}
                </button>
              </div>
            </div>
          ) : null}
        </div>
        {view === "month" ? (
          <MonthCalendar
            days={days as ReturnType<typeof monthGrid>}
            items={visible}
            selectedDate={date}
            onSelect={setDate}
            onOpen={openCalendarItem}
          />
        ) : view === "week" ? (
          <TimeGrid
            dates={days as readonly string[]}
            items={visible}
            onTaskDrop={(droppedTaskId, dropDate, time) =>
              void create({ taskId: droppedTaskId, date: dropDate, startTime: time })
            }
            onMove={(item, minutes) => void moveOrResize(item, minutes, minutes)}
            onResize={(item, minutes) => void moveOrResize(item, 0, minutes)}
            onEventDrop={(itemId, occurrenceDate, dropDate, time) =>
              void moveToSlot(itemId, occurrenceDate, dropDate, time)
            }
            onOpen={openCalendarItem}
          />
        ) : view === "day" ? (
          <TimeGrid
            dates={[date]}
            items={visible}
            onTaskDrop={(droppedTaskId, dropDate, time) =>
              void create({ taskId: droppedTaskId, date: dropDate, startTime: time })
            }
            onMove={(item, minutes) => void moveOrResize(item, minutes, minutes)}
            onResize={(item, minutes) => void moveOrResize(item, 0, minutes)}
            onEventDrop={(itemId, occurrenceDate, dropDate, time) =>
              void moveToSlot(itemId, occurrenceDate, dropDate, time)
            }
            onOpen={openCalendarItem}
          />
        ) : (
          <AgendaCalendar items={agendaItems} onOpen={openCalendarItem} />
        )}
      </div>
    </section>
  );
}

function MonthCalendar({
  days,
  items,
  selectedDate,
  onSelect,
  onOpen,
}: {
  days: ReturnType<typeof monthGrid>;
  items: readonly CalendarItem[];
  selectedDate: string;
  onSelect: (date: string) => void;
  onOpen: (itemId: string, occurrenceDate?: string | null) => void;
}) {
  const { locale, t } = useI18n();
  return (
    <div className="month-view" role="grid" aria-label={t("desktop.monthViewA11y")}>
      {weekDates("2026-01-05").map((date) => (
        <div key={date} className="month-weekday" role="columnheader">
          {formatWeekdayName(locale, date, "short")}
        </div>
      ))}
      {days.map((day) => {
        const dayItems = items.filter(
          (item) => item.startDate <= day.date && item.endDate >= day.date,
        );
        return (
          <button
            key={day.date}
            role="gridcell"
            aria-label={t("desktop.dayRecordA11y", {
              date: day.date,
              today: day.isToday ? t("desktop.todayA11ySuffix") : "",
              count: dayItems.length,
            })}
            aria-current={day.isToday ? "date" : undefined}
            aria-selected={day.date === selectedDate}
            className={`month-day ${day.inPeriod ? "" : "outside"} ${day.isToday ? "today" : ""}`}
            onClick={() => onSelect(day.date)}
            onKeyDown={(event) => {
              const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
              if (delta === undefined) return;
              event.preventDefault();
              const target = new Date(`${day.date}T00:00:00Z`);
              target.setUTCDate(target.getUTCDate() + delta);
              onSelect(target.toISOString().slice(0, 10));
            }}
          >
            <strong>{Number(day.date.slice(-2))}</strong>
            {dayItems.slice(0, 3).map((item) => (
              <span
                key={`${item.id}:${item.recurrenceId ?? item.startDate}`}
                className={`month-event category-${item.category}`}
                role="button"
                tabIndex={0}
                onClick={(event) => {
                  event.stopPropagation();
                  onOpen(item.id, item.recurrenceId);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  event.stopPropagation();
                  onOpen(item.id, item.recurrenceId);
                }}
              >
                {item.kind === "task_block" ? t("desktop.taskPrefix") : ""}
                {item.title}
              </span>
            ))}
            {dayItems.length > 3 ? (
              <small>{t("desktop.moreCount", { count: dayItems.length - 3 })}</small>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function TimeGrid({
  dates,
  items,
  onTaskDrop,
  onMove,
  onResize,
  onEventDrop,
  onOpen,
}: {
  dates: readonly string[];
  items: readonly CalendarItem[];
  onTaskDrop: (taskId: string, date: string, time: string) => void;
  onMove: (item: CalendarItem, minutes: number) => void;
  onResize: (item: CalendarItem, minutes: number) => void;
  onEventDrop: (itemId: string, occurrenceDate: string | null, date: string, time: string) => void;
  onOpen: (itemId: string, occurrenceDate?: string | null) => void;
}) {
  const { t } = useI18n();
  const now = new Date();
  const localToday = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
  const currentMinute = now.getHours() * 60 + now.getMinutes();
  return (
    <div
      className="time-grid"
      style={{ gridTemplateColumns: `64px repeat(${dates.length}, minmax(120px, 1fr))` }}
    >
      <div />
      {dates.map((date) => (
        <strong key={date} className="time-grid-header">
          {date}
        </strong>
      ))}
      <div className="all-day-label">{t("desktop.allDayLabel")}</div>
      {dates.map((date) => (
        <div key={`all-${date}`} className="all-day-cell">
          {items
            .filter((item) => item.allDay && item.startDate <= date && item.endDate >= date)
            .map((item) => (
              <CalendarEvent
                key={`${item.id}:${item.recurrenceId ?? item.startDate}`}
                item={item}
                onOpen={onOpen}
              />
            ))}
        </div>
      ))}
      <div className="time-axis">
        {Array.from({ length: 24 }, (_, hour) => (
          <span key={hour} style={{ top: hour * 60 }}>
            {String(hour).padStart(2, "0")}:00
          </span>
        ))}
      </div>
      {dates.map((date) => (
        <div
          key={`timed-${date}`}
          className="time-column"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            const taskId = event.dataTransfer.getData("text/stone-task");
            const itemId = event.dataTransfer.getData("text/stone-calendar");
            const occurrenceDate =
              event.dataTransfer.getData("text/stone-calendar-occurrence") || null;
            if (!taskId && !itemId) return;
            const bounds = event.currentTarget.getBoundingClientRect();
            const minute = Math.max(
              0,
              Math.min(23 * 60 + 45, Math.round((event.clientY - bounds.top) / 15) * 15),
            );
            const time = `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
            if (taskId) onTaskDrop(taskId, date, time);
            else onEventDrop(itemId, occurrenceDate, date, time);
          }}
        >
          {Array.from({ length: 24 }, (_, hour) => (
            <div key={hour} className="hour-line" style={{ top: hour * 60 }} />
          ))}
          {date === localToday ? (
            <div
              className="current-time-line"
              style={{ top: currentMinute }}
              role="separator"
              aria-label={t("calendar.now", {
                time: `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`,
              })}
            />
          ) : null}
          {layoutTimedItems(items, date).map((position) => (
            <div
              key={`${position.item.id}:${position.item.recurrenceId ?? position.item.startDate}`}
              className="positioned-event"
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData("text/stone-calendar", position.item.id);
                if (position.item.recurrenceId)
                  event.dataTransfer.setData(
                    "text/stone-calendar-occurrence",
                    position.item.recurrenceId,
                  );
              }}
              style={{
                top: position.top,
                height: Math.max(28, position.height),
                left: `${(position.column / position.columns) * 100}%`,
                width: `${100 / position.columns}%`,
              }}
            >
              <CalendarEvent
                item={position.item}
                onMove={onMove}
                onResize={onResize}
                onOpen={onOpen}
              />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function AgendaCalendar({
  items,
  onOpen,
}: {
  items: readonly AgendaItem[];
  onOpen: (itemId: string, occurrenceDate?: string | null) => void;
}) {
  const { t } = useI18n();
  const groups = new Map<string, AgendaItem[]>();
  for (const item of items) groups.set(item.date, [...(groups.get(item.date) ?? []), item]);
  return (
    <div className="agenda-list" role="list" aria-label={t("desktop.view.agenda")}>
      {items.length === 0 ? (
        <EmptyState title={t("desktop.agendaEmpty")} detail={t("desktop.agendaEmptyDetail")} />
      ) : null}
      {[...groups].map(([date, values]) => (
        <section key={date} aria-labelledby={`agenda-${date}`}>
          <h3 id={`agenda-${date}`}>{date}</h3>
          {values.map((item) => (
            <article
              key={item.id}
              role="listitem"
              tabIndex={item.calendarItemId ? 0 : undefined}
              className="calendar-event"
              aria-label={`${t(agendaKindKey(item.kind))}: ${item.title}, ${item.date}`}
              onClick={() => item.calendarItemId && onOpen(item.calendarItemId, item.date)}
              onKeyDown={(event) => {
                if (!item.calendarItemId || (event.key !== "Enter" && event.key !== " ")) return;
                event.preventDefault();
                onOpen(item.calendarItemId, item.date);
              }}
            >
              <span>{t(agendaKindKey(item.kind))}</span>
              <strong>{item.title}</strong>
              <small>
                {item.sortTime ?? t("desktop.allDayLabel")}
                {item.completed ? t("desktop.completedSuffix") : ""}
              </small>
            </article>
          ))}
        </section>
      ))}
    </div>
  );
}

function agendaKindKey(kind: AgendaItem["kind"]): TranslationKey {
  return {
    event: "calendar.event",
    task_block: "calendar.taskBlock",
    task_due: "calendar.taskDue",
    project_milestone: "calendar.projectTargetDate",
  }[kind] as TranslationKey;
}

function CalendarEvent({
  item,
  onMove,
  onResize,
  onOpen,
}: {
  item: CalendarItem;
  onMove?: (item: CalendarItem, minutes: number) => void;
  onResize?: (item: CalendarItem, minutes: number) => void;
  onOpen?: (itemId: string, occurrenceDate?: string | null) => void;
}) {
  const { t } = useI18n();
  const start = item.startAt ? instantToZonedWallTime(item.startAt, item.timezone).slice(11) : null;
  const end = item.endAt ? instantToZonedWallTime(item.endAt, item.timezone).slice(11) : null;
  return (
    <article
      role="listitem"
      tabIndex={0}
      aria-label={t("desktop.calendarRecordA11y", {
        kind: t(item.kind === "task_block" ? "calendar.taskBlock" : "calendar.event"),
        title: item.title,
        date: item.startDate,
      })}
      className={`calendar-event category-${item.category}`}
      onClick={() => onOpen?.(item.id, item.recurrenceId)}
      onKeyDown={(event) => {
        if (!onOpen || (event.key !== "Enter" && event.key !== " ")) return;
        event.preventDefault();
        onOpen(item.id, item.recurrenceId);
      }}
    >
      <span>
        {item.kind === "task_block"
          ? t("calendar.taskBlock")
          : item.allDay
            ? t("calendar.allDay")
            : t("calendar.event")}
      </span>
      <strong>{item.title}</strong>
      {!item.allDay ? (
        <small>
          {start}–{end} · {item.timezone}
        </small>
      ) : null}
      {item.taskId ? <small>{t("desktop.linkedTaskIndependent")}</small> : null}
      {onMove && onResize ? (
        <div className="calendar-event-actions">
          <button
            aria-label={t("desktop.moveEarlierA11y", { title: item.title })}
            onClick={() => onMove(item, -15)}
          >
            −15
          </button>
          <button
            aria-label={t("desktop.moveLaterA11y", { title: item.title })}
            onClick={() => onMove(item, 15)}
          >
            +15
          </button>
          <button
            aria-label={t("desktop.shortenA11y", { title: item.title })}
            onClick={() => onResize(item, -15)}
          >
            {t("desktop.shorten")}
          </button>
          <button
            aria-label={t("desktop.extendA11y", { title: item.title })}
            onClick={() => onResize(item, 15)}
          >
            {t("desktop.extend")}
          </button>
        </div>
      ) : null}
    </article>
  );
}

function TodayOverview({
  items,
  tasks,
  calendarItems,
  recentNotes,
  onOpen,
  onOpenTasks,
}: {
  items: readonly DesktopTodayItem[];
  tasks: readonly DesktopTask[];
  calendarItems: readonly CalendarItem[];
  recentNotes: readonly DesktopDocument[];
  onOpen: (documentId: string) => void;
  onOpenTasks: () => void;
}) {
  const { locale, t } = useI18n();
  const today = new Date().toISOString().slice(0, 10);
  const dueTasks = tasks
    .filter((task) => task.state === "open" && task.dueDate && task.dueDate <= today)
    .slice(0, 8);
  const timeline = buildAgendaItems(calendarItems, [], [], today, today);
  const scheduledTaskIds = new Set(
    timeline.filter((item) => item.kind === "task_block").map((item) => item.taskId),
  );
  const unscheduled = tasks
    .filter(
      (task) =>
        task.state === "open" &&
        task.priority === "high" &&
        !scheduledTaskIds.has(task.id) &&
        !dueTasks.some((dueTask) => dueTask.id === task.id),
    )
    .slice(0, 8);
  return (
    <section className="today-workspace">
      <div className="today-heading">
        <p className="eyebrow">{t("desktop.todayEyebrow")}</p>
        <h2 className="brand-heading">{t("desktop.todayTitle")}</h2>
        <p className="muted">{t("desktop.todayDetail")}</p>
      </div>
      {timeline.length > 0 ? (
        <div className="today-section" aria-label={t("desktop.todayTimelineA11y")}>
          <h3>{t("desktop.todayTimeline")}</h3>
          <div className="today-list">
            {timeline.map((item) => (
              <article key={item.id} className="calendar-event">
                <span>{t(agendaKindKey(item.kind))}</span>
                <strong>{item.title}</strong>
                <small>{item.sortTime ?? t("calendar.allDay")}</small>
              </article>
            ))}
          </div>
        </div>
      ) : null}
      <div className="today-columns">
        <section className="today-card">
          <h3>{t("tabs.tasks")}</h3>
          {dueTasks.length === 0 ? (
            <div className="inline-empty">
              <strong>{t("desktop.todayClear")}</strong>
              <span>{t("desktop.noDueTasks")}</span>
            </div>
          ) : (
            <div className="today-list">
              {dueTasks.map((task) => (
                <button key={task.id} onClick={onOpenTasks}>
                  <span className="today-kind today-kind-target">
                    {task.dueDate === today ? t("tasks.today") : t("desktop.overdue")}
                  </span>
                  <strong>{task.title}</strong>
                  <span>
                    {task.priority !== "none"
                      ? t("desktop.prioritySuffix", {
                          priority: formatTaskPriority(locale, task.priority),
                        })
                      : ""}
                    {task.dueDate}
                  </span>
                </button>
              ))}
            </div>
          )}
          {unscheduled.length > 0 ? (
            <div className="today-list">
              <h4>{t("desktop.unscheduledHighPriority")}</h4>
              {unscheduled.map((task) => (
                <button key={task.id} onClick={onOpenTasks}>
                  <strong>{task.title}</strong>
                  <span>{t("desktop.scheduleInCalendar")}</span>
                </button>
              ))}
            </div>
          ) : null}
        </section>
        <section className="today-card">
          <h3>{t("desktop.projectFocus")}</h3>
          {items.length === 0 ? (
            <div className="inline-empty">
              <strong>{t("desktop.todayClear")}</strong>
              <span>{t("desktop.noProjectSignals")}</span>
            </div>
          ) : (
            <div className="today-list">
              {items.map((item) => (
                <button key={item.id} onClick={() => onOpen(item.projectId)}>
                  <span className={`today-kind today-kind-${item.kind}`}>
                    {item.kind === "blocker"
                      ? t("tasks.blocker")
                      : item.kind === "target"
                        ? t("desktop.target")
                        : t("desktop.nextAction")}
                  </span>
                  <strong>{item.projectTitle}</strong>
                  <span>{item.text}</span>
                  {item.targetDate && <small>{item.targetDate}</small>}
                </button>
              ))}
            </div>
          )}
        </section>
        <section className="today-card">
          <h3>{t("desktop.recentNotes")}</h3>
          {recentNotes.length === 0 ? (
            <div className="inline-empty">
              <span>{t("desktop.noRecentNotes")}</span>
            </div>
          ) : (
            <div className="today-list">
              {recentNotes.map((note) => (
                <button key={note.id} onClick={() => onOpen(note.id)}>
                  <strong>{note.title}</strong>
                  <span>
                    {formatInstant(
                      locale,
                      note.updatedAt,
                      Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
                    )}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
function FullState({ label }: { label: string }) {
  return (
    <main className="full-state">
      <div className="brand-wordmark full-wordmark">Stone</div>
      <p>{label}</p>
    </main>
  );
}
function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
