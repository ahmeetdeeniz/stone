import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { EditorView, highlightActiveLine } from "@codemirror/view";
import { createEditorState } from "@stone/editor";
import { normalizeMarkdown } from "@stone/markdown";
import { listen } from "@tauri-apps/api/event";
import GithubPanel from "./GithubPanel";
import noteIcon from "../../../Icons/note-pencil.png";
import projectIcon from "../../../Icons/projector-screen-chart.png";
import todayIcon from "../../../Icons/calendar-dot.png";
import settingsIcon from "../../../Icons/gear.png";
import {
  buildProjectSummaries,
  buildTodayItems,
  type DesktopProjectSummary,
  type DesktopTodayItem,
} from "./project-summary";
import {
  desktopApi,
  isTauri,
  requireFirebaseConfigured,
  type AuthSession,
  type DesktopDocument,
  type FileFingerprint,
} from "./desktop-api";

type Section = "notes" | "projects" | "today" | "settings";
type Theme = "system" | "light" | "dark";
type SaveState = "saved" | "unsaved" | "saving" | "error";

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
    try {
      setSession(await desktopApi.authRestore());
    } catch (caught) {
      setError(
        `Kayıtlı oturum geri yüklenemedi: ${toMessage(caught)} Tekrar deneyebilir veya yeniden giriş yapabilirsiniz.`,
      );
    } finally {
      setAuthReady(true);
    }
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
  const projects = useMemo(() => buildProjectSummaries(documents), [documents]);
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
    if (!selectedId) {
      setDocument(null);
      return;
    }
    void desktopApi
      .getDocument(selectedId)
      .then(async (item) => {
        setDocument(item);
        draft.current = item?.markdown ?? "";
        setSaveState("saved");
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
            setSaveState("unsaved");
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
    setSaveState("saving");
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
      setSaveState("saved");
    } catch (caught) {
      setMessage(toMessage(caught));
      setSaveState("error");
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
          <NavButton
            active={section === "notes"}
            onClick={() => setSection("notes")}
            icon={<img src={noteIcon} alt="" />}
          >
            Notlar
          </NavButton>
          <NavButton
            active={section === "projects"}
            onClick={() => setSection("projects")}
            icon={<img src={projectIcon} alt="" />}
          >
            Projeler
          </NavButton>
          <NavButton
            active={section === "today"}
            onClick={() => setSection("today")}
            icon={<img src={todayIcon} alt="" />}
          >
            Bugün
          </NavButton>
          <NavButton
            active={section === "settings"}
            onClick={() => setSection("settings")}
            icon={<img src={settingsIcon} alt="" />}
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
        {section === "today" && (
          <TodayOverview items={todayItems} recentNotes={recentNotes} onOpen={openDocument} />
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
  icon: ReactNode;
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
            <span className="status-badge">{project.status}</span>
          </div>
          <span>
            {project.completedTasks}/{project.totalTasks} görev · {project.priority} öncelik
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
  recentNotes,
  onOpen,
}: {
  items: readonly DesktopTodayItem[];
  recentNotes: readonly DesktopDocument[];
  onOpen: (documentId: string) => void;
}) {
  return (
    <section className="today-workspace">
      <div className="today-heading">
        <p className="eyebrow">BUGÜN</p>
        <h2 className="brand-heading">Sıradaki önemli şeyler</h2>
        <p className="muted">Blocker, yaklaşan hedef ve sonraki işlerin sakin özeti.</p>
      </div>
      <div className="today-columns">
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
