import { useEffect, useMemo, useState } from "react";
import { attachmentTypeOf, extractAttachmentReferences } from "@stone/markdown";
import { desktopApi, isTauri } from "./desktop-api";
import { useI18n } from "./i18n";

type Preview = { status: "loading" } | { status: "ready"; url: string } | { status: "missing" };

/** Object URLs for image previews, shared across notes and kept for the session. */
const previews = new Map<string, Promise<string>>();

function loadPreview(fileName: string): Promise<string> {
  let preview = previews.get(fileName);
  if (!preview) {
    preview = desktopApi
      .readAttachment(fileName)
      .then((bytes) =>
        URL.createObjectURL(
          new Blob([bytes], { type: attachmentTypeOf(fileName)?.mimeType ?? "" }),
        ),
      );
    // A failed download is retried the next time the note is opened.
    preview.catch(() => previews.delete(fileName));
    previews.set(fileName, preview);
  }
  return preview;
}

/** Thumbnails and file chips for the attachments a note links to. */
export function AttachmentStrip({
  markdown,
  onError,
}: {
  markdown: string;
  onError: (message: string) => void;
}) {
  const { t } = useI18n();
  const references = useMemo(() => {
    const seen = new Set<string>();
    return extractAttachmentReferences(markdown).filter((reference) => {
      if (seen.has(reference.fileName)) return false;
      seen.add(reference.fileName);
      return true;
    });
  }, [markdown]);
  const imageKey = references
    .filter((reference) => reference.kind === "image")
    .map((reference) => reference.fileName)
    .join("|");
  const [states, setStates] = useState<ReadonlyMap<string, Preview>>(new Map());

  useEffect(() => {
    if (!isTauri || !imageKey) return;
    let active = true;
    for (const fileName of imageKey.split("|")) {
      setStates((current) =>
        current.get(fileName)?.status === "ready"
          ? current
          : new Map(current).set(fileName, { status: "loading" }),
      );
      loadPreview(fileName)
        .then((url) => {
          if (active)
            setStates((current) => new Map(current).set(fileName, { status: "ready", url }));
        })
        .catch(() => {
          if (active) setStates((current) => new Map(current).set(fileName, { status: "missing" }));
        });
    }
    return () => {
      active = false;
    };
  }, [imageKey]);

  if (references.length === 0) return null;
  return (
    <div className="attachment-strip" aria-label={t("attachments.listA11y")}>
      {references.map((reference) => {
        const state = states.get(reference.fileName);
        return (
          <button
            key={reference.fileName}
            className="attachment-item"
            title={reference.label}
            aria-label={t("attachments.openA11y", { name: reference.label })}
            onClick={() =>
              void desktopApi
                .openAttachment(reference.fileName)
                .catch((caught: unknown) =>
                  onError(caught instanceof Error ? caught.message : String(caught)),
                )
            }
          >
            {reference.kind === "image" && state?.status === "ready" ? (
              <img src={state.url} alt="" />
            ) : (
              <span className="attachment-placeholder" aria-hidden="true">
                {reference.kind === "pdf" ? "PDF" : state?.status === "missing" ? "⨯" : "…"}
              </span>
            )}
            <span className="attachment-label">
              {state?.status === "missing" ? t("attachments.unavailable") : reference.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
