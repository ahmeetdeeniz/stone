import { useEffect, useRef, useState } from "react";
import { EditorView } from "@codemirror/view";
import { createEditorState } from "@stone/editor";
import { normalizeMarkdown } from "@stone/markdown";
import { listen } from "@tauri-apps/api/event";
import {
  config,
  desktopApi,
  isTauri,
  type AuthSession,
  type DesktopDocument,
  type FileFingerprint,
} from "./desktop-api";

type Section = "notes" | "projects" | "today" | "settings";
type Theme = "system" | "light" | "dark";

function titleFromMarkdown(markdown: string): string {
  const heading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return heading || "Adsız not";
}

export default function App() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [authReady, setAuthReady] = useState(!isTauri);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isTauri) return;
    desktopApi
      .authRestore()
      .then(setSession)
      .catch(() => undefined)
      .finally(() => setAuthReady(true));
  }, []);

  if (!authReady) return <FullState label="Stone hazırlanıyor…" />;
  if (!session) {
    return <AuthScreen onAuthenticated={setSession} onError={setError} error={error} />;
  }
  return <StoneShell session={session} onSignedOut={() => setSession(null)} />;
}

function AuthScreen({
  onAuthenticated,
  onError,
  error,
}: {
  onAuthenticated: (session: AuthSession) => void;
  onError: (message: string | null) => void;
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
      if (!config.firebaseApiKey) throw new Error("VITE_FIREBASE_API_KEY yapılandırılmamış.");
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
      if (!config.firebaseApiKey) throw new Error("VITE_FIREBASE_API_KEY yapılandırılmamış.");
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
          <p className="error-text" role="alert">
            {error}
          </p>
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
  const editorHost = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView | null>(null);
  const draft = useRef("");

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
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            draft.current = update.state.doc.toString();
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
    } catch (caught) {
      setMessage(toMessage(caught));
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
          <span>Stone</span>
        </div>
        <nav aria-label="Ana menü">
          <NavButton active={section === "notes"} onClick={() => setSection("notes")} icon="▤">
            Notlar
          </NavButton>
          <NavButton
            active={section === "projects"}
            onClick={() => setSection("projects")}
            icon="◫"
          >
            Projeler
          </NavButton>
          <NavButton active={section === "today"} onClick={() => setSection("today")} icon="○">
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
          <Placeholder
            title="Projeler"
            detail="Proje takip ekranları bu masaüstü temelinin sonraki ürün adımında açılacak."
          />
        )}
        {section === "today" && (
          <Placeholder
            title="Bugün"
            detail="Bugün görünümü, proje görevleri etkinleştirildiğinde burada yer alacak."
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
      <h2>{title}</h2>
      <p>{detail}</p>
    </div>
  );
}
function Placeholder({ title, detail }: { title: string; detail: string }) {
  return (
    <section className="placeholder">
      <p className="eyebrow">TEMEL</p>
      <h2>{title}</h2>
      <p>{detail}</p>
    </section>
  );
}
function FullState({ label }: { label: string }) {
  return (
    <main className="full-state">
      <div className="brand-mark">S</div>
      <p>{label}</p>
    </main>
  );
}
function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
