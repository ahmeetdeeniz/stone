import { useEffect, useMemo, useState } from "react";
import {
  config,
  desktopApi,
  type GitHubAccount,
  type GitHubLink,
  type GitHubRepository,
  type GitReview,
  type RestoreItemResult,
} from "./desktop-api";

const githubClientConfigured = config.githubClientId.length > 0;

export default function GithubPanel() {
  const [account, setAccount] = useState<GitHubAccount | null>(null);
  const [repos, setRepos] = useState<GitHubRepository[]>([]);
  const [knownRepos, setKnownRepos] = useState<Map<number, GitHubRepository>>(new Map());
  const [links, setLinks] = useState<GitHubLink[]>([]);
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const [device, setDevice] = useState<{ code: string; uri: string; interval: number } | null>(
    null,
  );
  const [connecting, setConnecting] = useState(false);
  const [projectId, setProjectId] = useState("");
  const [root, setRoot] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [restoring, setRestoring] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [results, setResults] = useState<RestoreItemResult[]>([]);
  const [gitVersion, setGitVersion] = useState<string | null>(null);
  const [gitError, setGitError] = useState<string | null>(null);
  const [status, setStatus] = useState<GitReview | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [commitMessage, setCommitMessage] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void Promise.all([
      desktopApi.githubStatus(),
      desktopApi.githubListLinks(),
      desktopApi.gitSystemVersion(),
    ])
      .then(([currentAccount, currentLinks, version]) => {
        setAccount(currentAccount);
        setLinks(currentLinks);
        setGitVersion(version);
        if (currentAccount) void loadPage(1);
      })
      .catch((error: unknown) => setGitError(toMessage(error)));
  }, []);

  async function loadPage(nextPage: number) {
    setBusy(true);
    try {
      const result = await desktopApi.githubListRepositories(nextPage);
      setRepos(result.repositories);
      setKnownRepos((current) => {
        const next = new Map(current);
        for (const repository of result.repositories) next.set(repository.id, repository);
        return next;
      });
      setPage(result.page);
      setHasNext(result.hasNext);
    } catch (error) {
      setNotice(toMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function connect() {
    setConnecting(true);
    setNotice(null);
    try {
      const started = await desktopApi.githubDeviceStart();
      setDevice({
        code: started.userCode,
        uri: started.verificationUri,
        interval: started.interval,
      });
      await desktopApi.openGithubUrl(started.verificationUri);
      const deadline = Date.now() + started.expiresIn * 1000;
      let interval = started.interval;
      while (Date.now() < deadline) {
        await wait(interval * 1000);
        const polled = await desktopApi.githubDevicePoll(started.deviceCode);
        if (polled.status === "authorized" && polled.account) {
          setAccount(polled.account);
          setDevice(null);
          await loadPage(1);
          return;
        }
        if (polled.status === "denied" || polled.status === "expired")
          throw new Error("GitHub yetkilendirmesi tamamlanmadı.");
        interval = Math.max(5, polled.interval);
        setDevice({ code: started.userCode, uri: started.verificationUri, interval });
      }
      throw new Error("GitHub doğrulama kodunun süresi doldu.");
    } catch (error) {
      setNotice(toMessage(error));
    } finally {
      setConnecting(false);
    }
  }

  async function disconnect() {
    await desktopApi.githubDisconnect();
    setAccount(null);
    setRepos([]);
    setKnownRepos(new Map());
    setSelected(new Set());
    setDevice(null);
    setNotice("GitHub bağlantısı kaldırıldı.");
  }

  async function pickRoot() {
    const picked = await desktopApi.pickFolder();
    if (picked) setRoot(picked);
  }

  async function restore() {
    const chosen = [...knownRepos.values()]
      .filter((repo) => selected.has(repo.id))
      .map((repo) => ({ fullName: repo.fullName, sizeKb: repo.sizeKb }));
    if (!root || chosen.length === 0) return;
    setBusy(true);
    setRestoring(true);
    setResults([]);
    const nextRunId = crypto.randomUUID();
    setRunId(nextRunId);
    try {
      await desktopApi.restoreDiskCheck(root, chosen);
      const summary = await desktopApi.restoreRepositories(nextRunId, root, chosen);
      setResults(summary.results);
      setNotice(summary.cancelled ? "Restore iptal edildi." : "Restore tamamlandı.");
    } catch (error) {
      setNotice(toMessage(error));
    } finally {
      setBusy(false);
      setRestoring(false);
    }
  }

  function retryFailed() {
    const retry = results
      .filter((result) => result.status === "failed")
      .map((result) => {
        const repository = [...knownRepos.values()].find(
          (candidate) => candidate.fullName === result.fullName,
        );
        return repository ? { fullName: repository.fullName, sizeKb: repository.sizeKb } : null;
      })
      .filter((value): value is { fullName: string; sizeKb: number } => value !== null);
    if (!root || retry.length === 0) return;
    setSelected(
      new Set(
        retry
          .map((item) => repos.find((repo) => repo.fullName === item.fullName)?.id)
          .filter((value): value is number => value !== undefined),
      ),
    );
    setResults([]);
    setNotice("Başarısız repository'ler yeniden denenmeye hazır.");
  }

  async function link(repository: GitHubRepository) {
    if (!projectId.trim()) return;
    try {
      const saved = await desktopApi.githubLinkRepository(
        projectId.trim(),
        repository,
        links.find((item) => item.repository.id === repository.id)?.localPath,
      );
      setLinks((current) => [
        saved,
        ...current.filter((item) => item.projectId !== saved.projectId),
      ]);
      setNotice(`${repository.fullName} projeye bağlandı.`);
    } catch (error) {
      setNotice(toMessage(error));
    }
  }

  async function inspect(path: string) {
    try {
      const nextStatus = await desktopApi.gitReview(path);
      setStatus(nextStatus);
      setSelectedPaths(new Set(nextStatus.status.entries.map(gitEntryPath)));
    } catch (error) {
      setNotice(toMessage(error));
    }
  }

  async function pull(path: string) {
    try {
      await desktopApi.gitPull(path);
      await inspect(path);
      setNotice("Pull tamamlandı.");
    } catch (error) {
      setNotice(toMessage(error));
    }
  }

  async function commitAndPush(path: string) {
    if (!status || !commitMessage.trim()) return;
    const paths = [...selectedPaths];
    if (paths.length === 0) {
      setNotice("Commit için en az bir dosya seçin.");
      return;
    }
    try {
      await desktopApi.gitStageCommitPush(path, paths, commitMessage);
      setCommitMessage("");
      await inspect(path);
      setNotice("Commit ve push tamamlandı.");
    } catch (error) {
      setNotice(toMessage(error));
    }
  }

  const selectedCount = selected.size;
  const allSelected = repos.length > 0 && repos.every((repo) => selected.has(repo.id));
  const linkedByRepo = useMemo(
    () => new Map(links.map((link) => [link.repository.id, link])),
    [links],
  );

  if (!account) {
    return (
      <section className="github-panel">
        <PanelHeading
          title="GitHub"
          detail="Repository bağlantısı ve yeni bilgisayar restore işlemleri."
        />
        {!githubClientConfigured && (
          <p className="error-text">
            VITE_GITHUB_CLIENT_ID yapılandırılmamış. Device Flow etkinleştirilmiş kendi GitHub OAuth
            App client ID'nizi ekleyin.
          </p>
        )}
        {device && (
          <div className="device-card">
            <strong>{device.code}</strong>
            <span>{device.uri}</span>
            <button
              className="secondary-button"
              onClick={() => void desktopApi.openGithubUrl(device.uri)}
            >
              GitHub doğrulamasını aç
            </button>
          </div>
        )}
        <button
          className="primary-button"
          disabled={connecting || !githubClientConfigured}
          onClick={() => void connect()}
        >
          {connecting ? "GitHub bekleniyor…" : "GitHub hesabını bağla"}
        </button>
        {gitError && <p className="error-text">{gitError}</p>}
        {notice && <p className="hint">{notice}</p>}
      </section>
    );
  }

  return (
    <section className="github-panel">
      <PanelHeading
        title="GitHub"
        detail={`${account.login} bağlı · token Windows keychain'de tutulur.`}
      />
      <div className="github-toolbar">
        <span className="success-text">Bağlı</span>
        <span className="muted">{gitVersion ?? "Git kontrol ediliyor…"}</span>
        <button className="secondary-button" onClick={() => void disconnect()}>
          Bağlantıyı kaldır
        </button>
      </div>
      {gitError && <p className="error-text">{gitError}</p>}
      <div className="github-section">
        <div className="section-heading">
          <div>
            <h3>Repository'ler</h3>
            <p className="muted">GitHub erişiminizdeki public ve private repository'ler.</p>
          </div>
          <div className="toolbar-actions">
            <button
              className="secondary-button"
              disabled={busy || page === 1}
              onClick={() => void loadPage(page - 1)}
            >
              Önceki
            </button>
            <span className="muted">Sayfa {page}</span>
            <button
              className="secondary-button"
              disabled={busy || !hasNext}
              onClick={() => void loadPage(page + 1)}
            >
              Sonraki
            </button>
          </div>
        </div>
        <label>
          Stone proje kimliği
          <input
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
            placeholder="project-id"
          />
        </label>
        <div className="repo-list">
          {repos.map((repo) => {
            const linked = linkedByRepo.get(repo.id);
            return (
              <article className="repo-row" key={repo.id}>
                <input
                  type="checkbox"
                  checked={selected.has(repo.id)}
                  onChange={() =>
                    setSelected((current) => {
                      const next = new Set(current);
                      if (next.has(repo.id)) next.delete(repo.id);
                      else next.add(repo.id);
                      return next;
                    })
                  }
                  aria-label={`${repo.fullName} restore seçimi`}
                />
                <div className="repo-main">
                  <strong>{repo.fullName}</strong>
                  <span>
                    {repo.private ? "Private" : "Public"} · {formatSize(repo.sizeKb)} ·{" "}
                    {repo.defaultBranch}
                  </span>
                  {repo.sizeKb > 1_000_000 && (
                    <small className="warning-text">
                      Büyük repository; clone öncesi disk alanını kontrol edin.
                    </small>
                  )}
                  {linked && (
                    <small className="success-text">Stone projesi: {linked.projectId}</small>
                  )}
                </div>
                <div className="repo-actions">
                  <button
                    className="icon-button"
                    onClick={() => void desktopApi.openGithubUrl(repo.htmlUrl)}
                  >
                    GitHub
                  </button>
                  <button
                    className="icon-button"
                    disabled={!projectId.trim()}
                    onClick={() => void link(repo)}
                  >
                    Projeye bağla
                  </button>
                  {linked?.localPath && (
                    <>
                      <button
                        className="icon-button"
                        onClick={() => void inspect(linked.localPath!)}
                      >
                        İncele
                      </button>
                      <button className="icon-button" onClick={() => void pull(linked.localPath!)}>
                        Pull
                      </button>
                    </>
                  )}
                </div>
              </article>
            );
          })}
        </div>
        <div className="restore-controls">
          <div className="restore-root">
            <button className="secondary-button" onClick={() => void pickRoot()}>
              Hedef klasör seç
            </button>
            <span>{root || "Klasör seçilmedi"}</span>
          </div>
          <button
            className="text-button"
            onClick={() =>
              setSelected(allSelected ? new Set() : new Set(repos.map((repo) => repo.id)))
            }
          >
            {allSelected ? "Bu sayfanın seçimini kaldır" : "Bu sayfanın tümünü seç"}
          </button>
          <button
            className="primary-button"
            disabled={restoring || !root || selectedCount === 0}
            onClick={() => void restore()}
          >
            {restoring ? "Restore ediliyor…" : `${selectedCount} repository restore et`}
          </button>
          {restoring && runId && (
            <button
              className="secondary-button"
              onClick={() => void desktopApi.cancelRestore(runId)}
            >
              İptal
            </button>
          )}
        </div>
      </div>
      {results.length > 0 && (
        <div className="github-section">
          <div className="section-heading">
            <div>
              <h3>Restore özeti</h3>
              <p className="muted">
                Her repository ayrı sonuçlanır; başarısız olanlar yeniden denenebilir.
              </p>
            </div>
            <button className="secondary-button" onClick={() => void retryFailed()}>
              Başarısızları yeniden seç
            </button>
          </div>
          <div className="restore-results">
            {results.map((result) => (
              <div className="restore-result" key={result.fullName}>
                <strong>{result.fullName}</strong>
                <span className={`result-${result.status}`}>{result.status}</span>
                {result.path && (
                  <>
                    <button
                      className="icon-button"
                      onClick={() => void desktopApi.openExternalPath("vscode", result.path!)}
                    >
                      VS Code
                    </button>
                    <button
                      className="icon-button"
                      onClick={() => void desktopApi.openExternalPath("codex", result.path!)}
                    >
                      Codex
                    </button>
                  </>
                )}
                {result.error && <small className="error-text">{result.error}</small>}
                {result.warnings.map((warning) => (
                  <small className="warning-text" key={warning}>
                    {warning}
                  </small>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
      {status && (
        <div className="github-section review-card">
          <div className="section-heading">
            <div>
              <h3>Git review</h3>
              <p className="muted">
                Sadece aşağıdaki açıkça seçilen dosyalar stage edilir. Force push, reset ve clean
                sunulmaz.
              </p>
            </div>
            <span className={status.status.isDirty ? "warning-text" : "success-text"}>
              {status.status.isDirty ? "Değişiklik var" : "Temiz"}
            </span>
          </div>
          <pre>{status.diffStat || "Stage edilmiş diff yok."}</pre>
          {status.status.isDirty && (
            <>
              <div className="review-files">
                {status.status.entries.map((entry) => {
                  const filePath = gitEntryPath(entry);
                  return (
                    <label className="review-file" key={filePath}>
                      <input
                        type="checkbox"
                        checked={selectedPaths.has(filePath)}
                        onChange={() =>
                          setSelectedPaths((current) => {
                            const next = new Set(current);
                            if (next.has(filePath)) next.delete(filePath);
                            else next.add(filePath);
                            return next;
                          })
                        }
                      />
                      <code>{entry}</code>
                    </label>
                  );
                })}
              </div>
              <label>
                Commit mesajı
                <input
                  value={commitMessage}
                  onChange={(event) => setCommitMessage(event.target.value)}
                  placeholder="Değişikliği açıkla"
                />
              </label>
              <button
                className="primary-button"
                disabled={!commitMessage.trim() || selectedPaths.size === 0}
                onClick={() => void commitAndPush(status.status.path)}
              >
                Stage + Commit + Push
              </button>
            </>
          )}
        </div>
      )}
      {notice && <p className="hint">{notice}</p>}
    </section>
  );
}

function PanelHeading({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="panel-heading">
      <div className="brand-mark small">G</div>
      <div>
        <p className="eyebrow">INTEGRATION</p>
        <h2>{title}</h2>
        <p className="muted">{detail}</p>
      </div>
    </div>
  );
}
function formatSize(sizeKb: number): string {
  return sizeKb > 1024 * 1024
    ? `${(sizeKb / (1024 * 1024)).toFixed(1)} GB`
    : sizeKb > 1024
      ? `${(sizeKb / 1024).toFixed(1)} MB`
      : `${sizeKb} KB`;
}
function gitEntryPath(entry: string): string {
  const value = entry.slice(3).trim();
  const rename = value.lastIndexOf(" -> ");
  return rename >= 0 ? value.slice(rename + 4) : value;
}
function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
