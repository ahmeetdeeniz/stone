import * as Crypto from "expo-crypto";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, FlatList, Pressable, StyleSheet, View } from "react-native";
import type { Document } from "@stone/domain";
import { ResponsiveContent } from "../../src/components/responsive";
import { EmptyState, ErrorState, LoadingState } from "../../src/components/states";
import { Screen, StoneButton, StoneInput, StoneText, Surface } from "../../src/components/ui";
import { spacing } from "../../src/design/tokens";
import { useAuth } from "../../src/providers/auth-provider";
import { useAppServices } from "../../src/providers/app-provider";
import { pickAndImportNote } from "../../src/notes/note-files";

export default function NotesScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { noteUseCases, deviceId } = useAppServices();
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
      setError(caught instanceof Error ? caught.message : "Notlar okunamadı.");
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
        "Not oluşturulamadı",
        caught instanceof Error ? caught.message : "Yerel kayıt başarısız.",
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
        "Markdown içe aktarılamadı",
        caught instanceof Error ? caught.message : "Dosya okunamadı.",
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
        "Not güncellenemedi",
        caught instanceof Error ? caught.message : "Lütfen tekrar deneyin.",
      );
    }
  };

  const moveToTrash = (note: Document) => {
    Alert.alert("Notu çöpe taşı?", `“${note.title}” çöp kutusuna taşınacak.`, [
      { text: "Vazgeç", style: "cancel" },
      {
        text: "Çöpe taşı",
        style: "destructive",
        onPress: () => {
          void noteUseCases
            .trash(user!.uid, note.id, deviceId)
            .then(loadNotes)
            .catch((caught: unknown) => {
              Alert.alert(
                "Not silinemedi",
                caught instanceof Error ? caught.message : "Lütfen tekrar deneyin.",
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
            <StoneText variant="title1">Notlar</StoneText>
          </View>
          <View style={styles.headerActions}>
            <StoneButton
              label=".md Aç"
              variant="secondary"
              onPress={() => void importNote()}
              disabled={busy}
            />
            <StoneButton
              label="Yeni çizim"
              variant="secondary"
              onPress={() => router.push({ pathname: "/drawing/[id]", params: { id: "new" } })}
              disabled={busy}
            />
            <StoneButton label="Yeni not" onPress={() => void createNote()} disabled={busy} />
          </View>
        </View>
        <StoneInput
          label="Notlarda ara"
          value={search}
          onChangeText={setSearch}
          placeholder="Başlık veya içerik"
          returnKeyType="search"
        />
        {loading ? (
          <LoadingState label="Notlar yükleniyor" />
        ) : error ? (
          <ErrorState message={error} onRetry={() => void loadNotes()} />
        ) : (
          <FlatList
            data={notes}
            keyExtractor={(item) => item.id}
            contentContainerStyle={notes.length === 0 ? styles.emptyList : styles.list}
            ListEmptyComponent={
              <EmptyState
                title={search ? "Eşleşen not yok" : "İlk notunu oluştur"}
                description={
                  search
                    ? "Başka bir arama deneyin."
                    : "Yeni not ile yerel Markdown çalışma alanını başlatın."
                }
              />
            }
            renderItem={({ item }) => (
              <Surface>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${item.title} notunu aç`}
                  onPress={() => router.push({ pathname: "/editor", params: { id: item.id } })}
                >
                  <StoneText variant="title3">
                    {item.isPinned ? "★ " : ""}
                    {item.title}
                  </StoneText>
                  <StoneText variant="bodySmall" numberOfLines={2} style={styles.preview}>
                    {preview(item.markdown)}
                  </StoneText>
                  <StoneText variant="caption" style={styles.date}>
                    {formatDate(item.updatedAt)}
                  </StoneText>
                </Pressable>
                <View style={styles.cardActions}>
                  <StoneButton
                    label={item.isPinned ? "Sabitlemeyi kaldır" : "Sabitle"}
                    variant="quiet"
                    onPress={() => void togglePin(item)}
                  />
                  <StoneButton
                    label="Çöpe taşı"
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

function preview(markdown: string): string {
  return (
    markdown
      .replace(/^---[\s\S]*?---\s*/u, "")
      .replace(/[*_`>#-]/gu, "")
      .trim() || "Boş Markdown notu"
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
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
