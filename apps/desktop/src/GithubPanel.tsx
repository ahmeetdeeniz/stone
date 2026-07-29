import { useEffect, useMemo, useState } from "react";
import { formatFileSize } from "@stone/i18n";
import {
  config,
  desktopApi,
  type GitHubAccount,
  type GitHubLink,
  type GitHubRepository,
  type GitReview,
  type RestoreItemResult,
} from "./desktop-api";
import { restoreGitHubConnection } from "./github-restore";
import { useI18n } from "./i18n";

const githubClientConfigured = config.githubClientId.length > 0;

export default function GithubPanel() {
  const { locale, t, tp } = useI18n();
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
  const [storedConnectionFailed, setStoredConnectionFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void restoreGitHubConnection(desktopApi.githubStatus).then((result) => {
      if (result.status === "connected") {
        setStoredConnectionFailed(false);
        setAccount(result.account);
        void loadPage(1);
      } else if (result.status === "disconnected") {
        setStoredConnectionFailed(false);
        setAccount(null);
      } else {
        setStoredConnectionFailed(true);
        setNotice(t("github.storedConnectionFailed", { message: result.message }));
      }
    });
    void desktopApi
      .githubListLinks()
      .then(setLinks)
      .catch((error: unknown) =>
        setNotice(t("github.linksLoadFailed", { message: toMessage(error) })),
      );
    void desktopApi
      .gitSystemVersion()
      .then(setGitVersion)
      .catch((error: unknown) => setGitError(toMessage(error)));
  }, [t]);

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
          throw new Error(t("github.authorizationFailed"));
        interval = Math.max(5, polled.interval);
        setDevice({ code: started.userCode, uri: started.verificationUri, interval });
      }
      throw new Error(t("github.codeExpired"));
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
    setStoredConnectionFailed(false);
    setNotice(t("github.disconnected"));
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
      void desktopApi
        .githubListLinks()
        .then(setLinks)
        .catch(() => undefined);
      setNotice(summary.cancelled ? t("github.restoreCancelled") : t("github.restoreCompleted"));
    } catch (error) {
      setNotice(toMessage(error));
    } finally {
      setBusy(false);
      setRestoring(false);
    }
  }

  async function selectAllRepositories() {
    if (allSelected) {
      setSelected(new Set());
      return;
    }
    setBusy(true);
    try {
      const all = new Map(knownRepos);
      let nextPage = 1;
      for (let request = 0; request < 100; request += 1) {
        const result = await desktopApi.githubListRepositories(nextPage);
        for (const repository of result.repositories) all.set(repository.id, repository);
        if (!result.hasNext) break;
        nextPage += 1;
        if (request === 99) throw new Error(t("github.pageLimit"));
      }
      setKnownRepos(all);
      setSelected(new Set(all.keys()));
      setNotice(t("github.selectedForRestore", { count: all.size }));
    } catch (error) {
      setNotice(toMessage(error));
    } finally {
      setBusy(false);
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
    setNotice(t("github.failedReady"));
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
      setNotice(t("github.linkedToProject", { repository: repository.fullName }));
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
      setNotice(t("github.pullCompleted"));
    } catch (error) {
      setNotice(toMessage(error));
    }
  }

  async function commitAndPush(path: string) {
    if (!status || !commitMessage.trim()) return;
    const paths = [...selectedPaths];
    if (paths.length === 0) {
      setNotice(t("github.selectCommitFile"));
      return;
    }
    try {
      await desktopApi.gitStageCommitPush(path, paths, commitMessage);
      setCommitMessage("");
      await inspect(path);
      setNotice(t("github.pushCompleted"));
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
        <PanelHeading title="GitHub" detail={t("github.detail")} />
        {!githubClientConfigured && <p className="error-text">{t("github.clientMissing")}</p>}
        {device && (
          <div className="device-card">
            <strong>{device.code}</strong>
            <span>{device.uri}</span>
            <button
              className="secondary-button"
              onClick={() => void desktopApi.openGithubUrl(device.uri)}
            >
              {t("github.openVerification")}
            </button>
          </div>
        )}
        <button
          className="primary-button"
          disabled={connecting || !githubClientConfigured}
          onClick={() => void connect()}
        >
          {connecting ? t("github.waiting") : t("github.connect")}
        </button>
        {storedConnectionFailed && (
          <button className="secondary-button" onClick={() => void disconnect()}>
            {t("github.clearInvalidConnection")}
          </button>
        )}
        {gitError && <p className="error-text">{gitError}</p>}
        {notice && <p className="hint">{notice}</p>}
      </section>
    );
  }

  return (
    <section className="github-panel">
      <PanelHeading title="GitHub" detail={t("github.connectedDetail", { login: account.login })} />
      <div className="github-toolbar">
        <span className="success-text">{t("github.connected")}</span>
        <span className="muted">{gitVersion ?? t("github.checkingGit")}</span>
        <button className="secondary-button" onClick={() => void disconnect()}>
          {t("github.disconnect")}
        </button>
      </div>
      {gitError && <p className="error-text">{gitError}</p>}
      <div className="github-section">
        <div className="section-heading">
          <div>
            <h3>{t("github.repositories")}</h3>
            <p className="muted">{t("github.repositoriesDetail")}</p>
          </div>
          <div className="toolbar-actions">
            <button
              className="secondary-button"
              disabled={busy || page === 1}
              onClick={() => void loadPage(page - 1)}
            >
              {t("desktop.previous")}
            </button>
            <span className="muted">{t("github.page", { page })}</span>
            <button
              className="secondary-button"
              disabled={busy || !hasNext}
              onClick={() => void loadPage(page + 1)}
            >
              {t("desktop.next")}
            </button>
          </div>
        </div>
        <label>
          {t("github.projectId")}
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
                  aria-label={t("github.restoreSelectionA11y", { repository: repo.fullName })}
                />
                <div className="repo-main">
                  <strong>{repo.fullName}</strong>
                  <span>
                    {repo.private ? t("github.private") : t("github.public")} ·{" "}
                    {formatFileSize(locale, repo.sizeKb * 1024)} · {repo.defaultBranch}
                  </span>
                  {repo.sizeKb > 1_000_000 && (
                    <small className="warning-text">{t("github.largeRepository")}</small>
                  )}
                  {linked && (
                    <small className="success-text">
                      {t("github.stoneProject", { project: linked.projectId })}
                    </small>
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
                    {t("github.linkProject")}
                  </button>
                  {linked?.localPath && (
                    <>
                      <button
                        className="icon-button"
                        onClick={() => void inspect(linked.localPath!)}
                      >
                        {t("github.inspect")}
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
              {t("github.chooseTarget")}
            </button>
            <span>{root || t("github.noFolder")}</span>
          </div>
          <button
            className="text-button"
            disabled={busy}
            onClick={() => void selectAllRepositories()}
          >
            {allSelected ? t("github.clearSelection") : t("github.selectAll")}
          </button>
          <button
            className="primary-button"
            disabled={restoring || !root || selectedCount === 0}
            onClick={() => void restore()}
          >
            {restoring ? t("github.restoring") : tp("github.restoreCount", selectedCount)}
          </button>
          {restoring && runId && (
            <button
              className="secondary-button"
              onClick={() => void desktopApi.cancelRestore(runId)}
            >
              {t("common.cancel")}
            </button>
          )}
        </div>
      </div>
      {results.length > 0 && (
        <div className="github-section">
          <div className="section-heading">
            <div>
              <h3>{t("github.restoreSummary")}</h3>
              <p className="muted">{t("github.restoreSummaryDetail")}</p>
            </div>
            <button className="secondary-button" onClick={() => void retryFailed()}>
              {t("github.reselectFailed")}
            </button>
          </div>
          <div className="restore-results">
            {results.map((result) => (
              <div className="restore-result" key={result.fullName}>
                <strong>{result.fullName}</strong>
                <span className={`result-${result.status}`}>
                  {t(`github.status.${result.status}`)}
                </span>
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
              <h3>{t("github.review")}</h3>
              <p className="muted">{t("github.reviewDetail")}</p>
            </div>
            <span className={status.status.isDirty ? "warning-text" : "success-text"}>
              {status.status.isDirty ? t("github.dirty") : t("github.clean")}
            </span>
          </div>
          <pre>{status.diffStat || t("github.noStagedDiff")}</pre>
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
                {t("github.commitMessage")}
                <input
                  value={commitMessage}
                  onChange={(event) => setCommitMessage(event.target.value)}
                  placeholder={t("github.commitPlaceholder")}
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
  const { t } = useI18n();
  return (
    <div className="panel-heading">
      <div className="brand-mark small">G</div>
      <div>
        <p className="eyebrow">{t("github.integrationEyebrow")}</p>
        <h2>{title}</h2>
        <p className="muted">{detail}</p>
      </div>
    </div>
  );
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
