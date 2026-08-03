import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import * as Linking from "expo-linking";
import type { Document } from "@stone/domain";
import { extractDrawingBlocks, type ParsedStoneDrawingBlock } from "@stone/markdown";
import type { EditorBridgeMessage } from "@stone/editor";
import { ErrorState, LoadingState } from "../src/components/states";
import { ResponsiveContent } from "../src/components/responsive";
import { Screen, StoneButton, StoneInput, StoneText } from "../src/components/ui";
import { useTheme } from "../src/design/theme";
import { spacing } from "../src/design/tokens";
import { EditorWebView, type EditorWebViewHandle } from "../src/editor/EditorWebView";
import { exportNote } from "../src/notes/note-files";
import { useAuth } from "../src/providers/auth-provider";
import { useAppServices } from "../src/providers/app-provider";
import { useI18n } from "../src/i18n/provider";

export default function EditorScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const { colors, mode } = useTheme();
  const { user } = useAuth();
  const { noteUseCases, deviceId, drawings } = useAppServices();
  const { t } = useI18n();
  const webViewRef = useRef<EditorWebViewHandle>(null);
  const contentRef = useRef("");
  const selectionRef = useRef({ from: 0, to: 0 });
  const saveRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const [note, setNote] = useState<Document | null>(null);
  const [content, setContent] = useState("");
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"saved" | "unsaved" | "saving" | "error">("saved");
  const [recoveredDraft, setRecoveredDraft] = useState<string | null>(null);
  const [findQuery, setFindQuery] = useState("");
  const [drawingBlocks, setDrawingBlocks] = useState<readonly ParsedStoneDrawingBlock[]>([]);

  useEffect(() => {
    if (!id || !user) return;
    let active = true;
    setLoading(true);
    void noteUseCases
      .get(user.uid, id)
      .then(async (loaded) => {
        if (!active) return;
        if (!loaded) throw new Error(t("editor.notFound"));
        const draft = await noteUseCases.getDraft(user.uid, id);
        const useDraft = Boolean(
          draft && new Date(draft.updatedAt).getTime() > new Date(loaded.updatedAt).getTime(),
        );
        const nextContent = useDraft && draft ? draft.markdown : loaded.markdown;
        contentRef.current = nextContent;
        setContent(nextContent);
        setTitle(loaded.title);
        setNote(loaded);
        setDrawingBlocks(extractDrawingBlocks(nextContent));
        if (useDraft && draft) setRecoveredDraft(draft.markdown);
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof Error ? caught.message : t("editor.loadFailed"));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [id, noteUseCases, user]);

  const saveCurrent = useCallback(async () => {
    if (!note || !user) return;
    if (contentRef.current === note.markdown) {
      setStatus("saved");
      return;
    }
    setStatus("saving");
    try {
      const now = new Date().toISOString();
      await noteUseCases.saveDraft({
        documentId: note.id,
        ownerId: user.uid,
        markdown: contentRef.current,
        updatedAt: now,
        selectionFrom: selectionRef.current.from,
        selectionTo: selectionRef.current.to,
      });
      const updated = await noteUseCases.updateMarkdown(
        user.uid,
        note.id,
        contentRef.current,
        deviceId,
      );
      await noteUseCases.clearDraft(user.uid, note.id);
      setNote(updated);
      setStatus("saved");
    } catch (caught) {
      setStatus("error");
      setError(caught instanceof Error ? caught.message : t("editor.saveFailed"));
    }
  }, [deviceId, note, noteUseCases, user]);

  useEffect(() => {
    if (!note || !user) return;
    void drawings.list(user.uid, note.id).then((available) => {
      const availableIds = new Set(available.map((item) => item.id));
      setDrawingBlocks(extractDrawingBlocks(contentRef.current, availableIds));
    });
  }, [content, drawings, note, user]);
  saveRef.current = saveCurrent;

  useEffect(() => {
    if (!note) return;
    const timer = setTimeout(() => void saveCurrent(), 450);
    return () => clearTimeout(timer);
  }, [content, note, saveCurrent]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "background" || nextState === "inactive") void saveRef.current();
    });
    return () => subscription.remove();
  }, []);

  const handleMessage = (message: EditorBridgeMessage) => {
    if (message.type === "documentChanged") {
      contentRef.current = message.payload.markdown;
      setContent(message.payload.markdown);
      setStatus("unsaved");
    } else if (message.type === "selectionChanged" || message.type === "stateSnapshot") {
      selectionRef.current = { from: message.payload.from, to: message.payload.to };
    } else if (message.type === "openLink") {
      void Linking.openURL(message.payload.url);
    } else if (message.type === "editorError") {
      setError(message.payload.message);
    }
  };

  const rename = async () => {
    if (!note || !user || title.trim() === note.title) return;
    try {
      const updated = await noteUseCases.rename(user.uid, note.id, title, deviceId);
      setTitle(updated.title);
      setNote(updated);
    } catch (caught) {
      Alert.alert(
        t("editor.titleSaveFailed"),
        caught instanceof Error ? caught.message : t("app.unknownError"),
      );
    }
  };

  const moveToTrash = () => {
    if (!note || !user) return;
    Alert.alert(t("editor.trashConfirm"), t("editor.trashDetail"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("notes.moveToTrash"),
        style: "destructive",
        onPress: () =>
          void noteUseCases.trash(user.uid, note.id, deviceId).then(() => router.back()),
      },
    ]);
  };

  const shareExport = async () => {
    if (!note) return;
    try {
      await exportNote(note);
    } catch (caught) {
      Alert.alert(
        t("editor.exportFailed"),
        caught instanceof Error ? caught.message : t("projects.shareFailed"),
      );
    }
  };

  if (loading)
    return (
      <Screen>
        <LoadingState label={t("editor.preparing")} />
      </Screen>
    );
  if (error && !note)
    return (
      <Screen>
        <ErrorState
          message={error}
          onRetry={() => router.replace({ pathname: "/editor", params: { id } })}
        />
      </Screen>
    );
  if (!note || !id)
    return (
      <Screen>
        <ErrorState message={t("editor.notFound")} />
      </Screen>
    );

  return (
    <Screen padded={false}>
      <ResponsiveContent>
        <KeyboardAvoidingView
          style={styles.container}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View
            style={[
              styles.toolbar,
              { borderBottomColor: colors.border, backgroundColor: colors.surface },
            ]}
          >
            <StoneButton
              label={t("common.back")}
              variant="quiet"
              onPress={() => {
                void saveCurrent();
                router.back();
              }}
            />
            <StoneInput
              label={t("editor.noteTitle")}
              value={title}
              onChangeText={setTitle}
              onEndEditing={() => void rename()}
              containerStyle={styles.titleInput}
            />
            <View style={styles.toolbarActions}>
              <StoneText variant="caption" tone={status === "error" ? "danger" : "muted"}>
                {statusLabel(status, t)}
              </StoneText>
              {status === "saving" ? (
                <ActivityIndicator color={colors.primary} size="small" />
              ) : null}
              <StoneButton
                label={t("editor.export")}
                variant="quiet"
                onPress={() => void shareExport()}
              />
              {note ? (
                <StoneButton
                  label={t("focus.startLinked")}
                  variant="quiet"
                  onPress={() =>
                    router.push({
                      pathname: "/(tabs)/focus",
                      params: { documentId: note.id, projectId: note.projectId ?? undefined },
                    })
                  }
                />
              ) : null}
              <StoneButton label={t("notes.moveToTrash")} variant="quiet" onPress={moveToTrash} />
            </View>
          </View>
          <View
            style={[
              styles.findBar,
              { backgroundColor: colors.backgroundSecondary, borderBottomColor: colors.border },
            ]}
          >
            <StoneInput
              label={t("editor.search")}
              value={findQuery}
              onChangeText={(query) => {
                setFindQuery(query);
                webViewRef.current?.post({
                  protocolVersion: 1,
                  type: "setFindQuery",
                  payload: { query },
                });
              }}
              containerStyle={styles.findInput}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              onSubmitEditing={() =>
                webViewRef.current?.post({
                  protocolVersion: 1,
                  type: "executeCommand",
                  payload: { command: "find" },
                })
              }
            />
            <StoneButton
              label={t("editor.find")}
              variant="secondary"
              onPress={() =>
                webViewRef.current?.post({
                  protocolVersion: 1,
                  type: "executeCommand",
                  payload: { command: "find" },
                })
              }
            />
          </View>
          {recoveredDraft ? (
            <View
              style={[
                styles.recovery,
                { backgroundColor: colors.backgroundSecondary, borderColor: colors.border },
              ]}
            >
              <StoneText variant="bodySmall">{t("editor.recoveredDraft")}</StoneText>
              <StoneButton
                label={t("editor.discardDraft")}
                variant="quiet"
                onPress={() => {
                  contentRef.current = note.markdown;
                  setContent(note.markdown);
                  setRecoveredDraft(null);
                  void noteUseCases.clearDraft(user!.uid, note.id);
                }}
              />
            </View>
          ) : null}
          {drawingBlocks.length > 0 ? (
            <View
              style={[
                styles.drawingBlocks,
                { backgroundColor: colors.backgroundSecondary, borderBottomColor: colors.border },
              ]}
            >
              {drawingBlocks.map((block) => (
                <Pressable
                  key={block.id}
                  accessibilityRole="button"
                  accessibilityLabel={t("editor.openDrawingA11y", { title: block.title })}
                  onPress={() =>
                    router.push({ pathname: "/drawing/[id]", params: { id: block.id } })
                  }
                  style={[
                    styles.drawingBlock,
                    { borderColor: colors.border, backgroundColor: colors.surface },
                  ]}
                >
                  <StoneText variant="label">{block.title}</StoneText>
                  <StoneText variant="caption" style={{ color: colors.textSecondary }}>
                    {block.sourceAvailable
                      ? t("editor.editableDrawing")
                      : t("editor.missingDrawing")}
                  </StoneText>
                </Pressable>
              ))}
            </View>
          ) : null}
          <EditorWebView
            ref={webViewRef}
            documentId={note.id}
            markdown={content}
            theme={mode}
            onMessage={handleMessage}
          />
          {error ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("editor.dismissErrorA11y")}
              onPress={() => setError(null)}
              style={styles.error}
            >
              <StoneText variant="caption" tone="danger">
                {error}
              </StoneText>
            </Pressable>
          ) : null}
          <View
            style={[
              styles.commandBar,
              { backgroundColor: colors.surface, borderTopColor: colors.border },
            ]}
          >
            {(
              [
                ["toggleBold", t("editor.toolbar.bold")],
                ["toggleItalic", t("editor.toolbar.italic")],
                ["toggleBulletList", t("editor.toolbar.list")],
                ["toggleTask", t("editor.toolbar.task")],
                ["cycleHeading", t("editor.toolbar.heading")],
                ["undo", t("editor.toolbar.undo")],
                ["redo", t("editor.toolbar.redo")],
              ] as const
            ).map(([command, label]) => (
              <StoneButton
                key={command}
                label={label}
                variant="secondary"
                onPress={() =>
                  webViewRef.current?.post({
                    protocolVersion: 1,
                    type: "executeCommand",
                    payload: { command },
                  })
                }
              />
            ))}
          </View>
        </KeyboardAvoidingView>
      </ResponsiveContent>
    </Screen>
  );
}

function statusLabel(
  status: "saved" | "unsaved" | "saving" | "error",
  t: ReturnType<typeof useI18n>["t"],
): string {
  return status === "saved"
    ? t("editor.status.saved")
    : status === "saving"
      ? t("editor.status.saving")
      : status === "error"
        ? t("editor.status.error")
        : t("editor.status.unsaved");
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  toolbar: {
    minHeight: 72,
    borderBottomWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  titleInput: { flex: 1 },
  toolbarActions: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  recovery: {
    borderBottomWidth: 1,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  error: { padding: spacing.sm },
  findBar: {
    borderBottomWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  findInput: { flex: 1 },
  commandBar: {
    borderTopWidth: 1,
    padding: spacing.sm,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  drawingBlocks: { borderBottomWidth: 1, padding: spacing.sm, gap: spacing.sm },
  drawingBlock: { borderWidth: 1, borderRadius: 10, padding: spacing.sm, gap: spacing.xs },
});
