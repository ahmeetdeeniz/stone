import * as Crypto from "expo-crypto";
import { useRootNavigationState, useRouter } from "expo-router";
import { useShareIntentContext } from "expo-share-intent";
import { useEffect, useRef } from "react";
import { Alert } from "react-native";
import type { Document } from "@stone/domain";
import { useI18n } from "../i18n/provider";
import { useAppServices } from "../providers/app-provider";
import { useAuth } from "../providers/auth-provider";
import { appendInboxEntry, formatShareEntry } from "./share-inbox";

/**
 * Files text and links shared from other apps into an "Inbox" note as unchecked tasks, then opens
 * that note. Waits for sign-in and for the root navigator, so a share that cold-starts the app is
 * kept until both are ready.
 */
export function ShareInboxHandler() {
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();
  const { user, status } = useAuth();
  const { noteUseCases, notes, deviceId } = useAppServices();
  const { t } = useI18n();
  const router = useRouter();
  const navigationState = useRootNavigationState() as { key?: string } | undefined;
  const handling = useRef(false);

  useEffect(() => {
    if (!hasShareIntent || status !== "ready" || !user || !navigationState?.key) return;
    if (handling.current) return;
    handling.current = true;
    void (async () => {
      try {
        const entry = formatShareEntry(shareIntent, stampNow());
        if (!entry) return;
        const title = t("share.inboxTitle");
        const existing = (await notes.list(user.uid, { limit: 500 })).find(
          (note) =>
            note.kind === "note" &&
            note.title.trim().toLocaleLowerCase("tr") === title.toLocaleLowerCase("tr"),
        );
        const inbox: Document = existing
          ? await noteUseCases.updateMarkdown(
              user.uid,
              existing.id,
              appendInboxEntry(existing.markdown, entry),
              deviceId,
            )
          : await noteUseCases.create(newInbox(user.uid, deviceId, title, entry));
        router.push({ pathname: "/editor", params: { id: inbox.id } });
      } catch (error) {
        Alert.alert(
          t("share.saveFailed"),
          error instanceof Error ? error.message : t("app.unknownError"),
        );
      } finally {
        resetShareIntent();
        handling.current = false;
      }
    })();
  }, [
    deviceId,
    hasShareIntent,
    navigationState?.key,
    noteUseCases,
    notes,
    resetShareIntent,
    router,
    shareIntent,
    status,
    t,
    user,
  ]);

  return null;
}

function stampNow(): string {
  const now = new Date();
  const date = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(now);
  return `${date} ${time}`;
}

function newInbox(ownerId: string, deviceId: string, title: string, entry: string): Document {
  const now = new Date().toISOString();
  return {
    id: Crypto.randomUUID(),
    ownerId,
    kind: "note",
    title,
    markdown: appendInboxEntry(`# ${title}\n`, entry),
    path: null,
    projectId: null,
    isPinned: true,
    revision: 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    updatedByDeviceId: deviceId,
  };
}
