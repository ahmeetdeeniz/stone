import * as Crypto from "expo-crypto";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Alert, FlatList, StyleSheet, View } from "react-native";
import type { Document } from "@stone/domain";
import { formatInstant } from "@stone/i18n";
import { ResponsiveContent } from "../../src/components/responsive";
import { EmptyState, ErrorState, LoadingState } from "../../src/components/states";
import {
  Card,
  IconButton,
  Screen,
  ScreenHeader,
  SearchField,
  StoneButton,
  StoneText,
} from "../../src/components/ui";
import { spacing } from "../../src/design/tokens";
import { useAuth } from "../../src/providers/auth-provider";
import { useAppServices } from "../../src/providers/app-provider";
import { pickAndImportNote } from "../../src/notes/note-files";
import { useI18n } from "../../src/i18n/provider";

export default function NotesScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { noteUseCases, deviceId } = useAppServices();
  const { locale, t, tp } = useI18n();
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

  const subtitle = useMemo(() => tp("notes.count", notes.length), [notes.length, tp]);

  return (
    <Screen>
      <ResponsiveContent>
        <ScreenHeader
          eyebrow="Stone"
          title={t("tabs.notes")}
          subtitle={loading ? undefined : subtitle}
          actions={
            <>
              <IconButton
                icon="folder-open-outline"
                accessibilityLabel={t("notes.openMarkdown")}
                onPress={() => void importNote()}
                disabled={busy}
              />
              <IconButton
                icon="brush-outline"
                accessibilityLabel={t("notes.newDrawing")}
                onPress={() => router.push({ pathname: "/drawing/[id]", params: { id: "new" } })}
                disabled={busy}
              />
              <StoneButton
                label={t("notes.new")}
                icon="add"
                size="sm"
                onPress={() => void createNote()}
                disabled={busy}
              />
            </>
          }
        />
        <SearchField
          value={search}
          onChangeText={setSearch}
          placeholder={t("notes.searchPlaceholder")}
          accessibilityLabel={t("notes.search")}
          onClear={() => setSearch("")}
        />
        {loading ? (
          <LoadingState label={t("notes.loading")} />
        ) : error ? (
          <ErrorState message={error} onRetry={() => void loadNotes()} />
        ) : (
          <FlatList
            data={notes}
            keyExtractor={(item) => item.id}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={notes.length === 0 ? styles.emptyList : styles.list}
            ListEmptyComponent={
              <EmptyState
                icon={search ? "search-outline" : "document-text-outline"}
                title={search ? t("notes.searchEmpty") : t("notes.emptyTitle")}
                description={search ? t("notes.searchEmptyDetail") : t("notes.emptyDetail")}
                action={
                  search ? null : (
                    <StoneButton
                      label={t("notes.new")}
                      icon="add"
                      onPress={() => void createNote()}
                      disabled={busy}
                    />
                  )
                }
              />
            }
            renderItem={({ item }) => (
              <Card
                accessibilityLabel={t("notes.openA11y", { title: item.title })}
                onPress={() => router.push({ pathname: "/editor", params: { id: item.id } })}
              >
                <View style={styles.cardHead}>
                  <StoneText variant="title3" numberOfLines={1} style={styles.cardTitle}>
                    {item.title}
                  </StoneText>
                  <View style={styles.cardActions}>
                    <IconButton
                      icon={item.isPinned ? "star" : "star-outline"}
                      active={item.isPinned}
                      accessibilityLabel={item.isPinned ? t("notes.unpin") : t("notes.pin")}
                      onPress={() => void togglePin(item)}
                    />
                    <IconButton
                      icon="trash-outline"
                      tone="muted"
                      accessibilityLabel={t("notes.moveToTrash")}
                      onPress={() => moveToTrash(item)}
                    />
                  </View>
                </View>
                <StoneText variant="bodySmall" tone="secondary" numberOfLines={2}>
                  {preview(item.markdown, t("notes.emptyMarkdown"))}
                </StoneText>
                <StoneText variant="caption" tone="muted" style={styles.date}>
                  {formatInstant(
                    locale,
                    item.updatedAt,
                    Intl.DateTimeFormat().resolvedOptions().timeZone,
                  )}
                </StoneText>
              </Card>
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
  list: { gap: spacing.md, paddingTop: spacing.lg, paddingBottom: spacing.giant },
  emptyList: { flexGrow: 1 },
  cardHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  cardTitle: { flex: 1 },
  cardActions: { flexDirection: "row", alignItems: "center", marginRight: -spacing.sm },
  date: { marginTop: spacing.sm },
});
