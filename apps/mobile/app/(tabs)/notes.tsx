import * as Crypto from "expo-crypto";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, FlatList, Pressable, StyleSheet, View } from "react-native";
import type { Document } from "@stone/domain";
import { formatInstant } from "@stone/i18n";
import { ResponsiveContent } from "../../src/components/responsive";
import { EmptyState, ErrorState, LoadingState } from "../../src/components/states";
import { Screen, StoneButton, StoneInput, StoneText, Surface } from "../../src/components/ui";
import { spacing } from "../../src/design/tokens";
import { useAuth } from "../../src/providers/auth-provider";
import { useAppServices } from "../../src/providers/app-provider";
import { pickAndImportNote } from "../../src/notes/note-files";
import { useI18n } from "../../src/i18n/provider";

export default function NotesScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { noteUseCases, deviceId } = useAppServices();
  const { locale, t } = useI18n();
  const [notes, setNotes] = useState<readonly Document[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadNotes = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      setError(null);
      setNotes(await noteUseCases.list(user.uid, search ? { search } : {}));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("notes.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [noteUseCases, search, user]);

  useFocusEffect(
    useCallback(() => {
      void loadNotes();
    }, [loadNotes]),
  );

  const createNote = async () => {
    if (!user) return;
    setBusy(true);
    try {
      const now = new Date().toISOString();
      const note = await noteUseCases.create({
        id: Crypto.randomUUID(),
        ownerId: user.uid,
        kind: "note",
        title: "Untitled note",
        markdown: "# Untitled note\n\n",
        path: null,
        projectId: null,
        isPinned: false,
        revision: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        updatedByDeviceId: deviceId,
      });
      router.push({ pathname: "/editor", params: { id: note.id } });
    } catch (caught) {
      Alert.alert(
        t("notes.createFailed"),
        caught instanceof Error ? caught.message : t("notes.localSaveFailed"),
      );
    } finally {
      setBusy(false);
    }
  };

  const importNote = async () => {
    if (!user) return;
    setBusy(true);
    try {
      const note = await pickAndImportNote(user.uid, deviceId, noteUseCases);
      if (note) router.push({ pathname: "/editor", params: { id: note.id } });
    } catch (caught) {
      Alert.alert(
        t("notes.importFailed"),
        caught instanceof Error ? caught.message : t("notes.fileReadFailed"),
      );
    } finally {
      setBusy(false);
    }
  };

  const togglePin = async (note: Document) => {
    if (!user) return;
    try {
      await noteUseCases.setPinned(user.uid, note.id, !note.isPinned, deviceId);
      await loadNotes();
    } catch (caught) {
      Alert.alert(
        t("notes.updateFailed"),
        caught instanceof Error ? caught.message : t("app.unknownError"),
      );
    }
  };

  const moveToTrash = (note: Document) => {
    Alert.alert(t("notes.trashConfirm"), t("notes.trashDetail", { title: note.title }), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("notes.moveToTrash"),
        style: "destructive",
        onPress: () => {
          void noteUseCases
            .trash(user!.uid, note.id, deviceId)
            .then(loadNotes)
            .catch((caught: unknown) => {
              Alert.alert(
                t("notes.deleteFailed"),
                caught instanceof Error ? caught.message : t("app.unknownError"),
              );
            });
        },
      },
    ]);
  };

  return (
    <Screen>
      <ResponsiveContent>
        <View style={styles.header}>
          <View>
            <StoneText variant="display">Stone</StoneText>
            <StoneText variant="title1">{t("tabs.notes")}</StoneText>
          </View>
          <View style={styles.headerActions}>
            <StoneButton
              label={t("notes.openMarkdown")}
              variant="secondary"
              onPress={() => void importNote()}
              disabled={busy}
            />
            <StoneButton
              label={t("notes.newDrawing")}
              variant="secondary"
              onPress={() => router.push({ pathname: "/drawing/[id]", params: { id: "new" } })}
              disabled={busy}
            />
            <StoneButton label={t("notes.new")} onPress={() => void createNote()} disabled={busy} />
          </View>
        </View>
        <StoneInput
          label={t("notes.search")}
          value={search}
          onChangeText={setSearch}
          placeholder={t("notes.searchPlaceholder")}
          returnKeyType="search"
        />
        {loading ? (
          <LoadingState label={t("notes.loading")} />
        ) : error ? (
          <ErrorState message={error} onRetry={() => void loadNotes()} />
        ) : (
          <FlatList
            data={notes}
            keyExtractor={(item) => item.id}
            contentContainerStyle={notes.length === 0 ? styles.emptyList : styles.list}
            ListEmptyComponent={
              <EmptyState
                title={search ? t("notes.searchEmpty") : t("notes.emptyTitle")}
                description={search ? t("notes.searchEmptyDetail") : t("notes.emptyDetail")}
              />
            }
            renderItem={({ item }) => (
              <Surface>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("notes.openA11y", { title: item.title })}
                  onPress={() => router.push({ pathname: "/editor", params: { id: item.id } })}
                >
                  <StoneText variant="title3">
                    {item.isPinned ? "★ " : ""}
                    {item.title}
                  </StoneText>
                  <StoneText variant="bodySmall" numberOfLines={2} style={styles.preview}>
                    {preview(item.markdown, t("notes.emptyMarkdown"))}
                  </StoneText>
                  <StoneText variant="caption" style={styles.date}>
                    {formatInstant(
                      locale,
                      item.updatedAt,
                      Intl.DateTimeFormat().resolvedOptions().timeZone,
                    )}
                  </StoneText>
                </Pressable>
                <View style={styles.cardActions}>
                  <StoneButton
                    label={item.isPinned ? t("notes.unpin") : t("notes.pin")}
                    variant="quiet"
                    onPress={() => void togglePin(item)}
                  />
                  <StoneButton
                    label={t("notes.moveToTrash")}
                    variant="quiet"
                    onPress={() => moveToTrash(item)}
                  />
                </View>
              </Surface>
            )}
          />
        )}
      </ResponsiveContent>
    </Screen>
  );
}

function preview(markdown: string, emptyLabel: string): string {
  return (
    markdown
      .replace(/^---[\s\S]*?---\s*/u, "")
      .replace(/[*_`>#-]/gu, "")
      .trim() || emptyLabel
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
  headerActions: {
    flexDirection: "row",
    gap: spacing.sm,
    flexWrap: "wrap",
    justifyContent: "flex-end",
  },
  list: { gap: spacing.md, paddingTop: spacing.lg, paddingBottom: spacing.giant },
  emptyList: { flexGrow: 1 },
  preview: { color: "#747184", marginTop: spacing.sm },
  date: { color: "#9A96AA", marginTop: spacing.sm },
  cardActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
});
