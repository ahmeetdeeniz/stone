import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorView, highlightActiveLine } from "@codemirror/view";
import { createEditorState } from "@stone/editor";
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
  projectPriorityLabels,
  projectStatusLabels,
  zonedWallTimeToInstant,
  type ProjectPriority,
  type ProjectStatus,
  type AgendaItem,
  type CalendarItem,
  type CalendarRecurrenceEditScope,
} from "@stone/domain";
import GithubPanel from "./GithubPanel";
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

type Section = "notes" | "projects" | "tasks" | "calendar" | "today" | "settings";
type Theme = "system" | "light" | "dark";
function titleFromMarkdown(markdown: string): string {
  const heading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return heading || "Adsız not";
}

export default function App() {
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
      setError(
        `Kayıtlı oturum geri yüklenemedi: ${result.message} Tekrar deneyebilir veya yeniden giriş yapabilirsiniz.`,
      );
    }
    setAuthReady(true);
  }, []);

  useEffect(() => {
    if (!isTauri) return;
    void restoreSession();
  }, [restoreSession]);

  if (!authReady) return <FullState label="Stone hazırlanıyor…" />;
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
      onError(caught instanceof Error ? caught.message : "Giriş yapılamadı.");
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
      onError(
        caught instanceof Error ? caught.message : "Şifre sıfırlama e-postası gönderilemedi.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="auth-title">
        <div className="brand-mark">S</div>
        <p className="eyebrow">STONE</p>
        <h1 id="auth-title">Kendi çalışma alanın.</h1>
        <p className="muted">
          Kendi Firebase projenle giriş yap. Stone hesabını maintainer adına tutmaz.
        </p>
        <label>
          E-posta
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label>
          Şifre
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
            {error.startsWith("Kayıtlı oturum") && (
              <button className="text-button" disabled={busy} onClick={onRestore}>
                Oturumu yeniden dene
              </button>
            )}
          </div>
        )}
        {resetSent && (
          <p className="success-text" role="status">
            Sıfırlama e-postası gönderildi.
          </p>
        )}
        <button
          className="primary-button"
          disabled={busy || !email || !password}
          onClick={() => void signIn()}
        >
          {busy ? "Bekleyin…" : "Giriş yap"}
        </button>
        <button
          className="text-button"
          disabled={busy || !email}
          onClick={() => void resetPassword()}
        >
          Şifremi sıfırla
        </button>
        {!isTauri && (
          <p className="hint">
            Geliştirme için Tauri uygulamasını `pnpm desktop:dev` ile başlatın.
          </p>
        )}
      </section>
    </main>
  );
}

function StoneShell({ session, onSignedOut }: { session: AuthSession; onSignedOut: () => void }) {
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
      state: createEditorState(document.markdown, false, [
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
                ? { ...current, markdown: draft.current, title: titleFromMarkdown(draft.current) }
                : current,
            );
          }
        }),
      ]),
      parent: editorHost.current,
    });
    editor.current = view;
    return () => view.destroy();
  }, [document?.id]);

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
      title: "Yeni not",
      markdown: "# Yeni not\n\n",
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
        title: titleFromMarkdown(content),
        markdown: content,
        path: document.path,
      });
      setDocument(saved);
      setDocuments((current) => current.map((item) => (item.id === saved.id ? saved : item)));
      setMessage("Kaydedildi");
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
        setMessage(`${indexed.length} Markdown dosyası indekslendi.`);
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
          ? `${result.conflicts} çakışma çözülmeyi bekliyor.`
          : `${result.pushed} gönderildi, ${result.pulled} alındı.`,
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
      ? "Notlar"
      : section === "projects"
        ? "Projeler"
        : section === "tasks"
          ? "Görevler"
          : section === "calendar"
            ? "Takvim"
            : section === "today"
              ? "Bugün"
              : "Ayarlar";
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="brand-mark small">S</span>
          <span className="brand-wordmark">Stone</span>
        </div>
        <nav aria-label="Ana menü">
          <NavButton active={section === "notes"} onClick={() => setSection("notes")} icon="✎">
            Notlar
          </NavButton>
          <NavButton
            active={section === "projects"}
            onClick={() => setSection("projects")}
            icon="▦"
          >
            Projeler
          </NavButton>
          <NavButton active={section === "tasks"} onClick={() => setSection("tasks")} icon="✓">
            Görevler
          </NavButton>
          <NavButton
            active={section === "calendar"}
            onClick={() => setSection("calendar")}
            icon="□"
          >
            Takvim
          </NavButton>
          <NavButton active={section === "today"} onClick={() => setSection("today")} icon="◷">
            Bugün
          </NavButton>
          <NavButton
            active={section === "settings"}
            onClick={() => setSection("settings")}
            icon="⚙"
          >
            Ayarlar
          </NavButton>
        </nav>
        <div className="sidebar-bottom">
          <span className="sync-dot" /> {session.email}
        </div>
      </aside>
      <main className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">ÇALIŞMA ALANI</p>
            <h1>{activeLabel}</h1>
          </div>
          <div className="top-actions">
            <button className="secondary-button" disabled={syncing} onClick={() => void syncNow()}>
              {syncing ? "Eşitleniyor…" : "Eşitle"}
            </button>
            <button className="secondary-button" onClick={() => void openFolder()}>
              Klasör bağla
            </button>
            <button className="primary-button compact" onClick={() => void createNote()}>
              + Yeni not
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
            <section className="document-list" aria-label="Notlar">
              <div className="list-actions">
                <button className="text-button" onClick={() => void openFile()}>
                  Markdown aç
                </button>
                <span>{documents.length} not</span>
              </div>
              {documents.length === 0 ? (
                <EmptyState
                  title="Henüz not yok"
                  detail="Yeni bir not oluştur veya mevcut bir Markdown dosyasını aç."
                />
              ) : (
                documents.map((item) => (
                  <button
                    className={`document-row ${item.id === selectedId ? "selected" : ""}`}
                    key={item.id}
                    onClick={() => setSelectedId(item.id)}
                  >
                    <strong>{item.title || "Adsız not"}</strong>
                    <span>{item.path ?? "Stone yerel notu"}</span>
                  </button>
                ))
              )}
            </section>
            <section className="editor-panel" aria-label="Markdown editörü">
              {document ? (
                <>
                  <div className="editor-toolbar">
                    <div>
                      <strong>{document.title}</strong>
                      <span className={`save-state save-state-${saveState}`} aria-live="polite">
                        {saveState === "unsaved"
                          ? "Kaydedilmedi"
                          : saveState === "saving"
                            ? "Kaydediliyor…"
                            : saveState === "error"
                              ? "Kaydetme başarısız"
                              : "Kaydedildi"}
                      </span>
                      {document.path && <span className="path-label">{document.path}</span>}
                    </div>
                    <div className="toolbar-actions">
                      {document.path && (
                        <>
                          <button
                            className="icon-button"
                            title="VS Code ile aç"
                            onClick={() => void desktopApi.openExternal("vscode", document.path!)}
                          >
                            VS Code
                          </button>
                          <button
                            className="icon-button"
                            title="Codex ile aç"
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
                        Kaydet
                      </button>
                    </div>
                  </div>
                  {externalChange && (
                    <div className="conflict-banner" role="alert">
                      Dosya Stone dışında değişti. Kaydetmeden önce dış değişikliği kontrol et.
                    </div>
                  )}
                  <div className="editor-host" ref={editorHost} />
                </>
              ) : (
                <EmptyState
                  title="Bir not seç"
                  detail="Sol taraftan bir not seç veya yeni bir not oluştur."
                />
              )}
            </section>
          </div>
        )}
        {section === "projects" && (
          <section className="projects-workspace">
            <div className="project-intro">
              <p className="eyebrow">PROJE MERKEZİ</p>
              <h2>Aktif proje durumunu tek yerde izle</h2>
              <p className="muted">
                Durum, ilerleme, sürüm ve blocker özetleri taşınabilir proje Markdown’ından okunur.
                GitHub bağlantıları ve restore araçları aşağıda yönetilir.
              </p>
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
            onChange={setCalendarItems}
            onMessage={setMessage}
          />
        )}
        {section === "today" && (
          <TodayOverview
            items={todayItems}
            tasks={tasks}
            recentNotes={recentNotes}
            onOpen={openDocument}
            onOpenTasks={() => setSection("tasks")}
          />
        )}
        {section === "settings" && (
          <section className="settings-panel">
            <div className="settings-card">
              <h2>Görünüm</h2>
              <label>
                Tema
                <select value={theme} onChange={(event) => setTheme(event.target.value as Theme)}>
                  <option value="system">Sistem</option>
                  <option value="light">Açık</option>
                  <option value="dark">Koyu</option>
                </select>
              </label>
              <p className="muted">Kısayollar: Ctrl+N yeni not, Ctrl+S kaydet.</p>
            </div>
            <div className="settings-card">
              <h2>Hesap</h2>
              <p className="muted">{session.email}</p>
              <button className="secondary-button" onClick={() => void signOut()}>
                Çıkış yap
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
      onMessage("Görev yerel olarak kaydedildi.");
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
            <p className="eyebrow">PLANLAMA</p>
            <h2 id="task-heading">Görevler</h2>
          </div>
          <span>{visible.length} görev</span>
        </div>
        <form
          className="task-quick-add"
          onSubmit={(event) => {
            event.preventDefault();
            void add();
          }}
        >
          <label>
            Hızlı görev ekle
            <input value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <button className="primary-button compact" disabled={!title.trim()}>
            Ekle
          </button>
        </form>
        <label>
          Görevlerde ara
          <input value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
        <div className="task-filters" role="toolbar" aria-label="Görev görünümleri">
          {(["all", "today", "upcoming", "overdue", "completed"] as const).map((item) => (
            <button
              key={item}
              className={view === item ? "selected" : ""}
              aria-pressed={view === item}
              onClick={() => setView(item)}
            >
              {item === "all"
                ? "Tümü"
                : item === "today"
                  ? "Bugün"
                  : item === "upcoming"
                    ? "Yaklaşan"
                    : item === "overdue"
                      ? "Geciken"
                      : "Tamamlanan"}
            </button>
          ))}
        </div>
        <div className="task-list" role="list">
          {visible.length === 0 ? (
            <EmptyState title="Bu görünüm sakin" detail="Filtreye uyan görev yok." />
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
                  aria-label={`${task.title} görevini ${task.state === "completed" ? "yeniden aç" : "tamamla"}`}
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
                    {task.priority !== "none" ? `${task.priority} · ` : ""}
                    {task.dueDate ?? "Tarihsiz"}
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
  const [draft, setDraft] = useState<DesktopTask | null>(task);
  useEffect(() => setDraft(task), [task]);
  if (!draft)
    return (
      <aside className="task-editor">
        <EmptyState
          title="Bir görev seç"
          detail="Ayrıntıları düzenlemek için listeden görev seç."
        />
      </aside>
    );
  return (
    <aside className="task-editor" aria-label="Görev ayrıntıları">
      <h2>Görev ayrıntıları</h2>
      <label>
        Başlık
        <input
          value={draft.title}
          onChange={(event) => setDraft({ ...draft, title: event.target.value })}
        />
      </label>
      <label>
        Açıklama
        <textarea
          value={draft.description ?? ""}
          onChange={(event) => setDraft({ ...draft, description: event.target.value || null })}
        />
      </label>
      <div className="task-editor-grid">
        <label>
          Tarih
          <input
            type="date"
            value={draft.dueDate ?? ""}
            onChange={(event) => setDraft({ ...draft, dueDate: event.target.value || null })}
          />
        </label>
        <label>
          Saat
          <input
            type="time"
            value={draft.dueTime ?? ""}
            onChange={(event) => setDraft({ ...draft, dueTime: event.target.value || null })}
          />
        </label>
      </div>
      <label>
        Öncelik
        <select
          value={draft.priority}
          onChange={(event) =>
            setDraft({ ...draft, priority: event.target.value as DesktopTask["priority"] })
          }
        >
          <option value="none">Yok</option>
          <option value="low">Düşük</option>
          <option value="medium">Orta</option>
          <option value="high">Yüksek</option>
        </select>
      </label>
      <label>
        Proje
        <select
          value={draft.projectId ?? ""}
          onChange={(event) => setDraft({ ...draft, projectId: event.target.value || null })}
        >
          <option value="">Projesiz</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.title}
            </option>
          ))}
        </select>
      </label>
      <label>
        Etiketler
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
        Tahmini dakika
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
      <p className="muted">Saat bilgisi henüz işletim sistemi bildirimi planlamaz.</p>
      <div className="task-editor-actions">
        <button
          className="primary-button"
          disabled={!draft.title.trim()}
          onClick={() => onSave(draft)}
        >
          Kaydet
        </button>
        <button className="secondary-button" onClick={() => onDelete(draft)}>
          Sil
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
  if (projects.length === 0)
    return (
      <div className="inline-empty">
        <strong>Henüz proje belgesi yok</strong>
        <span>
          Mobilde oluşturulan veya bağlı klasördeki Stone proje Markdown’ı burada görünür.
        </span>
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
            <span className="status-badge">
              {projectStatusLabels[project.status as ProjectStatus] ?? project.status}
            </span>
          </div>
          <span>
            {project.completedTasks}/{project.totalTasks} görev ·{" "}
            {projectPriorityLabels[project.priority as ProjectPriority] ?? project.priority} öncelik
          </span>
          <progress
            max={Math.max(1, project.totalTasks)}
            value={project.completedTasks}
            aria-label={`${project.title} ilerlemesi`}
          />
          <span>
            {project.currentVersion ?? "Mevcut sürüm yok"} →{" "}
            {project.nextVersion ?? "Sonraki sürüm yok"}
          </span>
          <span>{project.nextAction ?? "Sonraki iş belirlenmedi"}</span>
          <span>
            {project.blockers.length > 0
              ? `${project.blockers.length} açık blocker`
              : "Açık blocker yok"}
            {project.versions.length > 0 ? ` · ${project.versions.length} sürüm` : ""}
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
  onChange,
  onMessage,
}: {
  items: readonly CalendarItem[];
  tasks: readonly DesktopTask[];
  projects: readonly DesktopProjectSummary[];
  onChange: (items: CalendarItem[]) => void;
  onMessage: (message: string) => void;
}) {
  const [view, setView] = useState<"month" | "week" | "day" | "agenda">("week");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [title, setTitle] = useState("");
  const [taskId, setTaskId] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [selectedOccurrenceDate, setSelectedOccurrenceDate] = useState<string | null>(null);
  const [recurrenceScope, setRecurrenceScope] = useState<CalendarRecurrenceEditScope>("occurrence");
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editPlanningNote, setEditPlanningNote] = useState("");
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
  useEffect(() => {
    setEditTitle(selectedItem?.title ?? "");
    setEditDescription(selectedItem?.description ?? "");
    setEditPlanningNote(selectedItem?.planningNote ?? "");
  }, [selectedItem]);

  function openCalendarItem(itemId: string, occurrenceDate?: string | null) {
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
    const task = tasks.find((value) => value.id === selectedTaskId);
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const scheduledDate = input?.date ?? date;
    const scheduledStart = input?.startTime ?? startTime;
    const startMinute = Number(scheduledStart.slice(0, 2)) * 60 + Number(scheduledStart.slice(3));
    const duration = task?.estimatedMinutes ?? 60;
    const endMinute = Math.min(startMinute + duration, 23 * 60 + 59);
    const scheduledEnd = `${String(Math.floor(endMinute / 60)).padStart(2, "0")}:${String(endMinute % 60).padStart(2, "0")}`;
    const item: CalendarItem = {
      schemaVersion: 1,
      id: crypto.randomUUID(),
      ownerId: "",
      revision: 0,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      updatedByDeviceId: "",
      kind: task ? "task_block" : "event",
      title: task?.title ?? title.trim(),
      description: null,
      allDay: false,
      startDate: scheduledDate,
      endDate: scheduledDate,
      startAt: zonedWallTimeToInstant(scheduledDate, scheduledStart, timezone, "earlier"),
      endAt: zonedWallTimeToInstant(
        scheduledDate,
        task ? scheduledEnd : endTime,
        timezone,
        "later",
      ),
      timezone,
      location: null,
      category: task ? "blue" : "purple",
      projectId: task?.projectId ?? null,
      sourceDocumentId: task?.sourceDocumentId ?? null,
      taskId: task?.id ?? null,
      planningNote: null,
      recurrence: null,
      recurrenceSeriesId: null,
      recurrenceId: null,
      overrides: [],
      externalUid: null,
      cancelledAt: null,
    };
    try {
      const saved = await desktopApi.saveCalendarItem(item);
      onChange([...items, saved]);
      setTitle("");
      setTaskId("");
      onMessage(
        task ? "Görev zaman bloğu olarak planlandı; son tarihi değişmedi." : "Etkinlik kaydedildi.",
      );
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
          ? "Yalnızca bu tekrar örneği yerel olarak güncellendi."
          : "Takvim kaydı yerel olarak güncellendi.",
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
      onMessage("Takvim kaydı yeni zamanına taşındı.");
    } catch (caught) {
      onMessage(toMessage(caught));
    }
  }
  async function saveSelected() {
    if (!selectedItem || !editTitle.trim()) return;
    try {
      const changes = {
        title: editTitle.trim(),
        description: editDescription.trim() || null,
      };
      const mutation =
        selectedItem.recurrence && selectedOccurrenceDate
          ? editCalendarRecurrence(
              selectedItem,
              selectedOccurrenceDate,
              recurrenceScope,
              changes,
              crypto.randomUUID(),
            )
          : {
              current: {
                ...selectedItem,
                ...changes,
                planningNote: editPlanningNote.trim() || null,
              },
              future: null,
            };
      const future = mutation.future ? await desktopApi.saveCalendarItem(mutation.future) : null;
      const saved = await desktopApi.saveCalendarItem(mutation.current);
      onChange([
        ...items.map((item) => (item.id === saved.id ? saved : item)),
        ...(future ? [future] : []),
      ]);
      if (future) openCalendarItem(future.id, future.startDate);
      onMessage("Etkinlik ayrıntıları kaydedildi.");
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
      openCalendarItem(saved.id);
      onMessage("Takvim kaydı açıkça çoğaltıldı.");
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
          ? "Zaman bloğu kaldırıldı; görev korunuyor."
          : "Etkinlik soft-delete edildi.",
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
          `${fresh.length} yeni kayıt ve ${parsed.length - fresh.length} yinelenen kayıt bulundu. İçe aktarılsın mı?`,
        )
      )
        return;
      for (const item of fresh) await desktopApi.saveCalendarItem(item);
      onChange(await desktopApi.listCalendarItems(rangeStart, rangeEnd));
      onMessage(
        `${fresh.length} takvim kaydı içe aktarıldı; ${parsed.length - fresh.length} yinelenen kayıt atlandı.`,
      );
    } catch (caught) {
      onMessage(toMessage(caught));
    }
  }
  async function exportIcs() {
    try {
      const exported = exportCalendarIcs(await desktopApi.listCalendarItemsForExport());
      const saved = await desktopApi.saveCalendarFile(exported);
      if (saved) onMessage("Takvim .ics dosyası dışa aktarıldı.");
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
    <section className="calendar-workspace" aria-label="Takvim">
      <div className="calendar-toolbar">
        <div className="segmented" role="group" aria-label="Takvim görünümü">
          {(["month", "week", "day", "agenda"] as const).map((value) => (
            <button key={value} aria-pressed={view === value} onClick={() => setView(value)}>
              {{ month: "Ay", week: "Hafta", day: "Gün", agenda: "Ajanda" }[value]}
            </button>
          ))}
        </div>
        <button onClick={() => shiftPeriod(-1)}>Önceki</button>
        <button onClick={() => setDate(new Date().toISOString().slice(0, 10))}>Bugün</button>
        <input
          aria-label="Tarihe git"
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
        />
        <button onClick={() => shiftPeriod(1)}>Sonraki</button>
        <button onClick={() => void importIcs()}>.ics içe aktar</button>
        <button onClick={() => void exportIcs()}>.ics dışa aktar</button>
      </div>
      <div className="calendar-grid">
        <div className="calendar-create">
          <h2>{date}</h2>
          <p className="muted">
            Saatler {Intl.DateTimeFormat().resolvedOptions().timeZone}. Yerel kayıt hemen yapılır.
          </p>
          <label>
            Etkinlik başlığı
            <input value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label>
            Veya görev planla
            <select value={taskId} onChange={(event) => setTaskId(event.target.value)}>
              <option value="">Görev seçilmedi</option>
              {tasks
                .filter((task) => task.state === "open" && !task.deletedAt)
                .map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.title}
                  </option>
                ))}
            </select>
            <div className="draggable-tasks" aria-label="Sürüklenebilir görevler">
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
          <div className="time-fields">
            <label>
              Başlangıç
              <input
                type="time"
                value={startTime}
                onChange={(event) => setStartTime(event.target.value)}
              />
            </label>
            <label>
              Bitiş
              <input
                type="time"
                value={endTime}
                onChange={(event) => setEndTime(event.target.value)}
              />
            </label>
          </div>
          <button
            className="primary-button"
            onClick={() => void create()}
            disabled={!title.trim() && !taskId}
          >
            Takvime ekle
          </button>
          <p className="hint">Hatırlatıcı ve odak zamanlayıcısı bu sürümde yoktur.</p>
          <div className="calendar-filters" aria-label="Takvim filtreleri">
            <label>
              Ara
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <label>
              Proje
              <select
                value={projectFilter}
                onChange={(event) => setProjectFilter(event.target.value)}
              >
                <option value="">Tüm projeler</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Tür
              <select
                value={kindFilter}
                onChange={(event) => setKindFilter(event.target.value as "" | CalendarItem["kind"])}
              >
                <option value="">Tüm türler</option>
                <option value="event">Etkinlik</option>
                <option value="task_block">Zaman bloğu</option>
              </select>
            </label>
            <label>
              Kategori
              <select
                value={categoryFilter}
                onChange={(event) =>
                  setCategoryFilter(event.target.value as "" | CalendarItem["category"])
                }
              >
                <option value="">Tüm kategoriler</option>
                {(["neutral", "purple", "blue", "green", "amber", "red"] as const).map(
                  (category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ),
                )}
              </select>
            </label>
            <label>
              Görev durumu
              <select
                value={completionFilter}
                onChange={(event) =>
                  setCompletionFilter(event.target.value as "" | "open" | "completed")
                }
              >
                <option value="">Tüm durumlar</option>
                <option value="open">Açık</option>
                <option value="completed">Tamamlandı</option>
              </select>
            </label>
          </div>
          {selectedItem ? (
            <div className="calendar-edit-panel">
              <h3>Seçili kaydı düzenle</h3>
              <label>
                Başlık
                <input value={editTitle} onChange={(event) => setEditTitle(event.target.value)} />
              </label>
              <label>
                Açıklama
                <textarea
                  value={editDescription}
                  onChange={(event) => setEditDescription(event.target.value)}
                />
              </label>
              <label>
                Planlama notu
                <textarea
                  value={editPlanningNote}
                  onChange={(event) => setEditPlanningNote(event.target.value)}
                />
              </label>
              {selectedItem.recurrence && selectedOccurrenceDate ? (
                <label>
                  Tekrarlanan kayıt kapsamı
                  <select
                    value={recurrenceScope}
                    onChange={(event) =>
                      setRecurrenceScope(event.target.value as CalendarRecurrenceEditScope)
                    }
                  >
                    <option value="occurrence">Yalnızca bu örnek</option>
                    <option value="future">Bu ve sonraki örnekler</option>
                    <option value="series">Tüm seri</option>
                  </select>
                </label>
              ) : null}
              <div className="calendar-event-actions">
                <button onClick={() => void saveSelected()}>Kaydet</button>
                <button onClick={() => void duplicateSelected()}>Çoğalt</button>
                <button onClick={() => void deleteSelected()}>
                  {selectedItem.kind === "task_block" ? "Bloğu kaldır" : "Sil"}
                </button>
              </div>
            </div>
          ) : null}
        </div>
        {view === "month" ? (
          <MonthCalendar
            days={days as ReturnType<typeof monthGrid>}
            items={visible}
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
  onSelect,
  onOpen,
}: {
  days: ReturnType<typeof monthGrid>;
  items: readonly CalendarItem[];
  onSelect: (date: string) => void;
  onOpen: (itemId: string, occurrenceDate?: string | null) => void;
}) {
  return (
    <div className="month-view" role="grid" aria-label="Ay görünümü">
      {["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"].map((label) => (
        <div key={label} className="month-weekday" role="columnheader">
          {label}
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
            aria-label={`${day.date}${day.isToday ? ", bugün" : ""}, ${dayItems.length} kayıt`}
            aria-current={day.isToday ? "date" : undefined}
            className={`month-day ${day.inPeriod ? "" : "outside"} ${day.isToday ? "today" : ""}`}
            onClick={() => onSelect(day.date)}
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
                {item.kind === "task_block" ? "Görev · " : ""}
                {item.title}
              </span>
            ))}
            {dayItems.length > 3 ? <small>+{dayItems.length - 3} daha</small> : null}
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
      <div className="all-day-label">Tüm gün</div>
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
  const groups = new Map<string, AgendaItem[]>();
  for (const item of items) groups.set(item.date, [...(groups.get(item.date) ?? []), item]);
  return (
    <div className="agenda-list" role="list" aria-label="Ajanda">
      {items.length === 0 ? (
        <EmptyState title="Ajanda boş" detail="Bu aralıkta kayıt yok." />
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
              aria-label={`${agendaKindLabel(item.kind)}: ${item.title}, ${item.date}`}
              onClick={() => item.calendarItemId && onOpen(item.calendarItemId, item.date)}
              onKeyDown={(event) => {
                if (!item.calendarItemId || (event.key !== "Enter" && event.key !== " ")) return;
                event.preventDefault();
                onOpen(item.calendarItemId, item.date);
              }}
            >
              <span>{agendaKindLabel(item.kind)}</span>
              <strong>{item.title}</strong>
              <small>
                {item.sortTime ?? "Tüm gün"}
                {item.completed ? " · Tamamlandı" : ""}
              </small>
            </article>
          ))}
        </section>
      ))}
    </div>
  );
}

function agendaKindLabel(kind: AgendaItem["kind"]): string {
  return {
    event: "Etkinlik",
    task_block: "Zaman bloğu",
    task_due: "Görev son tarihi",
    project_milestone: "Proje hedef tarihi",
  }[kind];
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
  const start = item.startAt ? instantToZonedWallTime(item.startAt, item.timezone).slice(11) : null;
  const end = item.endAt ? instantToZonedWallTime(item.endAt, item.timezone).slice(11) : null;
  return (
    <article
      role="listitem"
      tabIndex={0}
      aria-label={`${item.kind === "task_block" ? "Zaman bloğu" : "Etkinlik"} ${item.title}, ${item.startDate}`}
      className={`calendar-event category-${item.category}`}
      onClick={() => onOpen?.(item.id, item.recurrenceId)}
      onKeyDown={(event) => {
        if (!onOpen || (event.key !== "Enter" && event.key !== " ")) return;
        event.preventDefault();
        onOpen(item.id, item.recurrenceId);
      }}
    >
      <span>
        {item.kind === "task_block" ? "Zaman bloğu" : item.allDay ? "Tüm gün" : "Etkinlik"}
      </span>
      <strong>{item.title}</strong>
      {!item.allDay ? (
        <small>
          {start}–{end} · {item.timezone}
        </small>
      ) : null}
      {item.taskId ? <small>Bağlı görev · blok, görevden bağımsızdır</small> : null}
      {onMove && onResize ? (
        <div className="calendar-event-actions">
          <button
            aria-label={`${item.title} kaydını 15 dakika erkene taşı`}
            onClick={() => onMove(item, -15)}
          >
            −15
          </button>
          <button
            aria-label={`${item.title} kaydını 15 dakika ileri taşı`}
            onClick={() => onMove(item, 15)}
          >
            +15
          </button>
          <button
            aria-label={`${item.title} süresini 15 dakika kısalt`}
            onClick={() => onResize(item, -15)}
          >
            Kısalt
          </button>
          <button
            aria-label={`${item.title} süresini 15 dakika uzat`}
            onClick={() => onResize(item, 15)}
          >
            Uzat
          </button>
        </div>
      ) : null}
    </article>
  );
}

function TodayOverview({
  items,
  tasks,
  recentNotes,
  onOpen,
  onOpenTasks,
}: {
  items: readonly DesktopTodayItem[];
  tasks: readonly DesktopTask[];
  recentNotes: readonly DesktopDocument[];
  onOpen: (documentId: string) => void;
  onOpenTasks: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const dueTasks = tasks
    .filter((task) => task.state === "open" && task.dueDate && task.dueDate <= today)
    .slice(0, 8);
  return (
    <section className="today-workspace">
      <div className="today-heading">
        <p className="eyebrow">BUGÜN</p>
        <h2 className="brand-heading">Sıradaki önemli şeyler</h2>
        <p className="muted">Blocker, yaklaşan hedef ve sonraki işlerin sakin özeti.</p>
      </div>
      <div className="today-columns">
        <section className="today-card">
          <h3>Görevler</h3>
          {dueTasks.length === 0 ? (
            <div className="inline-empty">
              <strong>Bugün sakin</strong>
              <span>Bugüne kalan veya geciken görev yok.</span>
            </div>
          ) : (
            <div className="today-list">
              {dueTasks.map((task) => (
                <button key={task.id} onClick={onOpenTasks}>
                  <span className="today-kind today-kind-target">
                    {task.dueDate === today ? "Bugün" : "Gecikti"}
                  </span>
                  <strong>{task.title}</strong>
                  <span>
                    {task.priority !== "none" ? `${task.priority} öncelik · ` : ""}
                    {task.dueDate}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
        <section className="today-card">
          <h3>Proje odağı</h3>
          {items.length === 0 ? (
            <div className="inline-empty">
              <strong>Bugün sakin</strong>
              <span>Açık blocker, yaklaşan hedef veya tanımlı sonraki iş yok.</span>
            </div>
          ) : (
            <div className="today-list">
              {items.map((item) => (
                <button key={item.id} onClick={() => onOpen(item.projectId)}>
                  <span className={`today-kind today-kind-${item.kind}`}>
                    {item.kind === "blocker"
                      ? "Blocker"
                      : item.kind === "target"
                        ? "Hedef"
                        : "Sonraki iş"}
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
          <h3>Son güncellenen notlar</h3>
          {recentNotes.length === 0 ? (
            <div className="inline-empty">
              <span>Henüz yakın zamanda güncellenmiş not yok.</span>
            </div>
          ) : (
            <div className="today-list">
              {recentNotes.map((note) => (
                <button key={note.id} onClick={() => onOpen(note.id)}>
                  <strong>{note.title}</strong>
                  <span>{new Date(note.updatedAt).toLocaleString("tr-TR")}</span>
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
