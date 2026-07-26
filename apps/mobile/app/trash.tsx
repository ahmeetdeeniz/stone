import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, FlatList, StyleSheet, View } from "react-native";
import type { Document } from "@stone/domain";
import { ErrorState, EmptyState, LoadingState } from "../src/components/states";
import { ResponsiveContent } from "../src/components/responsive";
import { Screen, StoneButton, StoneText, Surface } from "../src/components/ui";
import { spacing } from "../src/design/tokens";
import { useAuth } from "../src/providers/auth-provider";
import { useAppServices } from "../src/providers/app-provider";

export default function TrashScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { noteUseCases, deviceId } = useAppServices();
  const [notes, setNotes] = useState<readonly Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      setError(null);
      setNotes(await noteUseCases.list(user.uid, { includeDeleted: true }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Çöp kutusu okunamadı.");
    } finally {
      setLoading(false);
    }
  }, [noteUseCases, user]);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const permanentlyDelete = (note: Document) => {
    if (!user) return;
    Alert.alert("Notu kalıcı olarak sil?", "Bu işlem geri alınamaz.", [
      { text: "Vazgeç", style: "cancel" },
      {
        text: "Kalıcı sil",
        style: "destructive",
        onPress: () => void noteUseCases.permanentlyDelete(user.uid, note.id).then(load),
      },
    ]);
  };

  return (
    <Screen>
      <ResponsiveContent>
        <View style={styles.header}>
          <StoneButton label="Geri" variant="quiet" onPress={() => router.back()} />
          <StoneText variant="title1">Çöp kutusu</StoneText>
        </View>
        {loading ? (
          <LoadingState label="Çöp kutusu yükleniyor" />
        ) : error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : (
          <FlatList
            data={notes}
            keyExtractor={(item) => item.id}
            contentContainerStyle={notes.length === 0 ? styles.empty : styles.list}
            ListEmptyComponent={
              <EmptyState title="Çöp kutusu boş" description="Silinen notlar burada tutulur." />
            }
            renderItem={({ item }) => (
              <Surface>
                <StoneText variant="title3">{item.title}</StoneText>
                <StoneText variant="caption" style={styles.deleted}>
                  Silindi: {item.deletedAt ? new Date(item.deletedAt).toLocaleString("tr-TR") : "—"}
                </StoneText>
                <View style={styles.actions}>
                  <StoneButton
                    label="Geri al"
                    variant="secondary"
                    onPress={() =>
                      void noteUseCases.restore(user!.uid, item.id, deviceId).then(load)
                    }
                  />
                  <StoneButton
                    label="Kalıcı sil"
                    variant="quiet"
                    onPress={() => permanentlyDelete(item)}
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

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginBottom: spacing.xl },
  list: { gap: spacing.md, paddingBottom: spacing.giant },
  empty: { flexGrow: 1 },
  deleted: { color: "#9A96AA", marginTop: spacing.sm },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
});
