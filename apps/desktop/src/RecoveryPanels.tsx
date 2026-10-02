import { useCallback, useEffect, useState } from "react";
import { formatInstant, type Locale, type TranslationKey } from "@stone/i18n";
import { mergeTextThreeWay } from "@stone/sync";
import {
  desktopApi,
  type ConflictResolution,
  type DesktopConflict,
  type DocumentRevisionSummary,
  type TrashedDocument,
} from "./desktop-api";
import { useI18n } from "./i18n";

const entityLabels: Record<DesktopConflict["entityType"], TranslationKey> = {
  document: "desktop.entity.document",
  task: "desktop.entity.task",
  calendar: "desktop.entity.calendar",
  focus: "desktop.entity.focus",
  focus_goal: "desktop.entity.focus_goal",
  project: "desktop.entity.project",
};

function when(locale: Locale, instant: string): string {
  return formatInstant(locale, instant, Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : typeof error === "string" ? error : fallback;
}

/** Open sync conflicts, resolved here instead of only on a phone. */
export function ConflictsPanel({
  refreshKey,
  onResolved,
}: {
  refreshKey: number;
  onResolved: (copiedDocumentId: string | null) => void;
}) {
  const { locale, t, tp } = useI18n();
  const [conflicts, setConflicts] = useState<DesktopConflict[] | null>(null);
  const [merged, setMerged] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await desktopApi.listConflicts();
      setConflicts(next);
      setMerged((current) =>
        Object.fromEntries(
          next
            .filter((item) => item.entityType === "document" && item.remote)
            .map((item) => [
              item.id,
              current[item.id] ??
                mergeTextThreeWay(
                  item.baseMarkdown ?? "",
                  asText(item.local.markdown),
                  asText(item.remote?.markdown),
                ).text,
            ]),
        ),
      );
      setError(null);
    } catch (caught) {
      setError(errorText(caught, t("conflicts.loadFailed")));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  async function resolve(conflict: DesktopConflict, resolution: ConflictResolution) {
    setBusyId(conflict.id);
    try {
      const outcome = await desktopApi.resolveConflict(
        conflict.id,
        resolution,
        resolution === "merged" ? merged[conflict.id] : undefined,
      );
      await load();
      onResolved(outcome.copiedDocumentId);
    } catch (caught) {
      setError(`${t("conflicts.resolveFailed")}: ${errorText(caught, t("app.unknownError"))}`);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="settings-card recovery-card">
      <h2>{t("conflicts.title")}</h2>
      <p className="muted">
        {conflicts === null
          ? t("conflicts.loading")
          : conflicts.length === 0
            ? t("conflicts.emptyDetail")
            : tp("conflicts.open", conflicts.length)}
      </p>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {conflicts?.map((conflict) => {
        const isDocument = conflict.entityType === "document";
        const busy = busyId === conflict.id;
        return (
          <article className="conflict-item" key={conflict.id}>
            <header>
              <strong>{conflict.title}</strong>
              <span className="muted">
                {t(entityLabels[conflict.entityType])} · {when(locale, conflict.createdAt)}
              </span>
            </header>
            {isDocument ? (
              <div className="conflict-columns">
                <label>
                  {t("conflicts.local")}
                  <textarea readOnly value={asText(conflict.local.markdown)} rows={8} />
                </label>
                <label>
                  {t("conflicts.remote")}
                  {conflict.remote ? (
                    <textarea readOnly value={asText(conflict.remote.markdown)} rows={8} />
                  ) : (
                    <span className="muted">{t("desktop.conflictRemoteDeleted")}</span>
                  )}
                </label>
                {conflict.remote && (
                  <label>
                    {t("conflicts.mergedMarkdown")}
                    <textarea
                      value={merged[conflict.id] ?? ""}
                      rows={8}
                      onChange={(event) =>
                        setMerged((current) => ({ ...current, [conflict.id]: event.target.value }))
                      }
                    />
                  </label>
                )}
              </div>
            ) : (
              conflict.remoteDeleted && (
                <p className="muted">{t("desktop.conflictRemoteDeleted")}</p>
              )
            )}
            <div className="button-row">
              {conflict.remoteDeleted ? (
                <>
                  {isDocument && (
                    <button
                      className="secondary-button"
                      disabled={busy}
                      onClick={() => void resolve(conflict, "local")}
                    >
                      {t("desktop.conflictKeepCopy")}
                    </button>
                  )}
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => void resolve(conflict, "remote")}
                  >
                    {t("desktop.conflictAcceptDeletion")}
                  </button>
                </>
              ) : (
                <>
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => void resolve(conflict, "local")}
                  >
                    {t("conflicts.useLocal")}
                  </button>
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => void resolve(conflict, "remote")}
                  >
                    {t("conflicts.useRemote")}
                  </button>
                  {isDocument && (
                    <button
                      className="primary-button compact"
                      disabled={busy}
                      onClick={() => void resolve(conflict, "merged")}
                    >
                      {t("conflicts.merge")}
                    </button>
                  )}
                </>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}

/** Notes deleted on any device, restorable until purged. */
export function TrashPanel({
  refreshKey,
  onRestored,
}: {
  refreshKey: number;
  onRestored: (documentId: string) => void;
}) {
  const { locale, t } = useI18n();
  const [items, setItems] = useState<TrashedDocument[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await desktopApi.listTrash());
      setError(null);
    } catch (caught) {
      setError(errorText(caught, t("trash.loadFailed")));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  async function restore(id: string) {
    try {
      await desktopApi.restoreDocument(id);
      await load();
      onRestored(id);
    } catch (caught) {
      setError(errorText(caught, t("app.unknownError")));
    }
  }

  return (
    <div className="settings-card recovery-card">
      <h2>{t("trash.title")}</h2>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {items === null ? (
        <p className="muted">{t("trash.loading")}</p>
      ) : items.length === 0 ? (
        <p className="muted">
          {t("trash.empty")} · {t("trash.emptyDetail")}
        </p>
      ) : (
        <ul className="recovery-list">
          {items.map((item) => (
            <li key={item.id}>
              <span>
                <strong>{item.title || t("desktop.untitledNote")}</strong>
                <span className="muted">{when(locale, item.deletedAt)}</span>
              </span>
              <button className="secondary-button" onClick={() => void restore(item.id)}>
                {t("common.restore")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Saved versions of the open note; restoring loads one into the editor as an unsaved draft. */
export function HistoryPanel({
  documentId,
  revision,
  onRestore,
  onClose,
}: {
  documentId: string;
  revision: number;
  onRestore: (markdown: string) => void;
  onClose: () => void;
}) {
  const { locale, t } = useI18n();
  const [items, setItems] = useState<DocumentRevisionSummary[] | null>(null);
  const [selected, setSelected] = useState<{ id: string; markdown: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setSelected(null);
    void desktopApi
      .listDocumentRevisions(documentId)
      .then((next) => {
        if (active) setItems(next);
      })
      .catch((caught: unknown) => {
        if (active) setError(errorText(caught, t("app.unknownError")));
      });
    return () => {
      active = false;
    };
  }, [documentId, revision, t]);

  async function select(id: string) {
    try {
      setSelected({ id, markdown: await desktopApi.getDocumentRevision(id) });
    } catch (caught) {
      setError(errorText(caught, t("app.unknownError")));
    }
  }

  return (
    <aside className="history-panel" aria-label={t("desktop.history")}>
      <header>
        <strong>{t("desktop.history")}</strong>
        <button className="text-button" onClick={onClose}>
          {t("common.close")}
        </button>
      </header>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {items === null ? (
        <p className="muted">{t("app.loading")}</p>
      ) : items.length === 0 ? (
        <p className="muted">{t("desktop.historyEmpty")}</p>
      ) : (
        <ul className="recovery-list">
          {items.map((item) => (
            <li key={item.id}>
              <button
                className={`history-row ${selected?.id === item.id ? "selected" : ""}`}
                onClick={() => void select(item.id)}
              >
                <strong>
                  r{item.revision} · {when(locale, item.createdAt)}
                </strong>
                <span className="muted">{item.preview}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {selected && (
        <div className="history-preview">
          <pre>{selected.markdown}</pre>
          <button className="primary-button compact" onClick={() => onRestore(selected.markdown)}>
            {t("desktop.restoreVersion")}
          </button>
        </div>
      )}
    </aside>
  );
}
