import { useCallback, useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { isTauri } from "./desktop-api";
import { useI18n } from "./i18n";

export type UpdateState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "current" }
  | { status: "available"; update: Update }
  | { status: "installing"; percent: number | null }
  | { status: "unavailable" }
  | { status: "error"; message: string };

/** First automatic check waits so it never competes with startup and the first sync. */
const AUTOMATIC_CHECK_DELAY_MS = 15_000;

/**
 * The updater plugin is only registered in release builds that carry an updater public key;
 * anywhere else `check()` fails because the plugin is missing, which is not an error to show.
 */
export function isUpdaterMissing(message: string): boolean {
  return /plugin.*(not found|not initialized|updater)|updater.*not.*(found|initialized|configured)/iu.test(
    message,
  );
}

export function downloadPercent(downloaded: number, total: number | undefined): number | null {
  if (!total || total <= 0) return null;
  return Math.min(100, Math.round((downloaded / total) * 100));
}

export function useAppUpdates() {
  const [state, setState] = useState<UpdateState>({ status: "idle" });
  const [version, setVersion] = useState<string | null>(null);
  const checking = useRef(false);

  const runCheck = useCallback(async (manual: boolean) => {
    if (!isTauri || checking.current) return;
    checking.current = true;
    if (manual) setState({ status: "checking" });
    try {
      const update = await check();
      setState(update ? { status: "available", update } : { status: "current" });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      if (isUpdaterMissing(message)) setState({ status: "unavailable" });
      else if (manual) setState({ status: "error", message });
      else setState({ status: "idle" });
    } finally {
      checking.current = false;
    }
  }, []);

  useEffect(() => {
    if (!isTauri) return;
    void getVersion()
      .then(setVersion)
      .catch(() => undefined);
    const timer = window.setTimeout(() => void runCheck(false), AUTOMATIC_CHECK_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [runCheck]);

  const install = useCallback(async () => {
    if (state.status !== "available") return;
    const { update } = state;
    let downloaded = 0;
    let total: number | undefined;
    setState({ status: "installing", percent: null });
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") total = event.data.contentLength;
        if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          setState({ status: "installing", percent: downloadPercent(downloaded, total) });
        }
      });
      // Windows installers close the app themselves; macOS and Linux need a restart.
      await relaunch();
    } catch (caught) {
      setState({
        status: "error",
        message: caught instanceof Error ? caught.message : String(caught),
      });
    }
  }, [state]);

  return { state, version, check: () => runCheck(true), install };
}

export function UpdateBanner({ state, onInstall }: { state: UpdateState; onInstall: () => void }) {
  const { t } = useI18n();
  if (state.status !== "available" && state.status !== "installing") return null;
  return (
    <div className="update-banner" role="status">
      {state.status === "available" ? (
        <>
          <span>{t("desktop.updateAvailable", { version: state.update.version })}</span>
          <button className="primary-button compact" onClick={onInstall}>
            {t("desktop.updateInstall")}
          </button>
        </>
      ) : (
        <span>
          {state.percent === null
            ? t("desktop.updateInstalling")
            : t("desktop.updateDownloading", { percent: state.percent })}
        </span>
      )}
    </div>
  );
}

export function UpdateSettingsCard({
  state,
  version,
  onCheck,
  onInstall,
}: {
  state: UpdateState;
  version: string | null;
  onCheck: () => void;
  onInstall: () => void;
}) {
  const { t } = useI18n();
  const detail =
    state.status === "checking"
      ? t("desktop.updateChecking")
      : state.status === "current"
        ? t("desktop.updateCurrent")
        : state.status === "unavailable"
          ? t("desktop.updateUnavailable")
          : state.status === "error"
            ? t("desktop.updateFailed", { message: state.message })
            : state.status === "available"
              ? t("desktop.updateAvailable", { version: state.update.version })
              : null;
  return (
    <div className="settings-card">
      <h2>{t("desktop.updatesTitle")}</h2>
      {version && <p className="muted">{t("desktop.appVersion", { version })}</p>}
      {detail && <p className={state.status === "error" ? "error-text" : "muted"}>{detail}</p>}
      {state.status === "available" ? (
        <button className="primary-button compact" onClick={onInstall}>
          {t("desktop.updateInstall")}
        </button>
      ) : (
        <button
          className="secondary-button"
          disabled={state.status === "checking" || state.status === "installing"}
          onClick={onCheck}
        >
          {t("desktop.updateCheck")}
        </button>
      )}
    </div>
  );
}
