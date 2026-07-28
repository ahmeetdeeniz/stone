import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorView, highlightActiveLine } from "@codemirror/view";
import { createEditorState } from "@stone/editor";
import { normalizeMarkdown } from "@stone/markdown";
import { listen } from "@tauri-apps/api/event";
import {
  projectPriorityLabels,
  projectStatusLabels,
  type ProjectPriority,
  type ProjectStatus,
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
  desktopApi,
  isTauri,
  requireFirebaseConfigured,
  type AuthSession,
  type DesktopDocument,
  type DesktopTask,
  type FileFingerprint,
} from "./desktop-api";

type Section = "notes" | "projects" | "tasks" | "today" | "settings";
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
