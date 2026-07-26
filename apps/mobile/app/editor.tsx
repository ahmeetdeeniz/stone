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

export default function EditorScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const { colors, mode } = useTheme();
  const { user } = useAuth();
  const { noteUseCases, deviceId } = useAppServices();
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

  useEffect(() => {
    if (!id || !user) return;
    let active = true;
    setLoading(true);
    void noteUseCases
      .get(user.uid, id)
      .then(async (loaded) => {
        if (!active) return;
        if (!loaded) throw new Error("Not bulunamadı.");
        const draft = await noteUseCases.getDraft(user.uid, id);
        const useDraft = Boolean(
          draft && new Date(draft.updatedAt).getTime() > new Date(loaded.updatedAt).getTime(),
        );
        const nextContent = useDraft && draft ? draft.markdown : loaded.markdown;
        contentRef.current = nextContent;
        setContent(nextContent);
        setTitle(loaded.title);
        setNote(loaded);
        if (useDraft && draft) setRecoveredDraft(draft.markdown);
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof Error ? caught.message : "Not yüklenemedi.");
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
      setError(caught instanceof Error ? caught.message : "Not kaydedilemedi.");
    }
  }, [deviceId, note, noteUseCases, user]);
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
        "Başlık kaydedilemedi",
        caught instanceof Error ? caught.message : "Lütfen tekrar deneyin.",
      );
    }
  };

  const moveToTrash = () => {
    if (!note || !user) return;
    Alert.alert("Notu çöpe taşı?", "Bu not çöp kutusundan geri alınabilir.", [
      { text: "Vazgeç", style: "cancel" },
      {
        text: "Çöpe taşı",
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
        "Not dışa aktarılamadı",
        caught instanceof Error ? caught.message : "Paylaşım başlatılamadı.",
      );
    }
  };

  if (loading)
    return (
      <Screen>
        <LoadingState label="Editor hazırlanıyor" />
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
        <ErrorState message="Not bulunamadı." />
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
              label="Geri"
              variant="quiet"
              onPress={() => {
                void saveCurrent();
                router.back();
              }}
            />
            <StoneInput
              label="Not başlığı"
              value={title}
              onChangeText={setTitle}
              onEndEditing={() => void rename()}
              containerStyle={styles.titleInput}
            />
            <View style={styles.toolbarActions}>
              <StoneText
                variant="caption"
                style={{ color: status === "error" ? "#C95B67" : colors.textMuted }}
              >
                {statusLabel(status)}
              </StoneText>
              {status === "saving" ? (
                <ActivityIndicator color={colors.primary} size="small" />
              ) : null}
              <StoneButton label="Dışa aktar" variant="quiet" onPress={() => void shareExport()} />
              <StoneButton label="Çöpe taşı" variant="quiet" onPress={moveToTrash} />
            </View>
          </View>
          {recoveredDraft ? (
            <View
              style={[
                styles.recovery,
                { backgroundColor: colors.backgroundSecondary, borderColor: colors.border },
              ]}
            >
              <StoneText variant="bodySmall">Kaydedilmemiş taslak kurtarıldı.</StoneText>
              <StoneButton
                label="Taslağı sil"
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
          <EditorWebView
            ref={webViewRef}
            documentId={note.id}
            markdown={content}
            theme={mode}
            onMessage={handleMessage}
          />
          {error ? (
            <Pressable onPress={() => setError(null)} style={styles.error}>
              <StoneText variant="caption" style={{ color: "#C95B67" }}>
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
                ["toggleBold", "Kalın"],
                ["toggleItalic", "İtalik"],
                ["toggleBulletList", "Liste"],
                ["toggleTask", "Görev"],
                ["cycleHeading", "Başlık"],
                ["undo", "Geri al"],
                ["redo", "Yinele"],
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

function statusLabel(status: "saved" | "unsaved" | "saving" | "error"): string {
  return status === "saved"
    ? "Kaydedildi"
    : status === "saving"
      ? "Kaydediliyor…"
      : status === "error"
        ? "Hata"
        : "Kaydedilmemiş değişiklik";
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
  commandBar: {
    borderTopWidth: 1,
    padding: spacing.sm,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
});
