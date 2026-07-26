import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Alert, FlatList, StyleSheet, View } from "react-native";
import { mergeTextThreeWay } from "@stone/sync";
import type { LocalConflict } from "../src/infrastructure/storage/sync";
import { EmptyState, ErrorState, LoadingState } from "../src/components/states";
import { ResponsiveContent } from "../src/components/responsive";
import { Screen, StoneButton, StoneInput, StoneText, Surface } from "../src/components/ui";
import { spacing } from "../src/design/tokens";
import { useAuth } from "../src/providers/auth-provider";
import { useAppServices } from "../src/providers/app-provider";

export default function ConflictsScreen() {
  const { user } = useAuth();
  const { syncStore, deviceId } = useAppServices();
  const [conflicts, setConflicts] = useState<readonly LocalConflict[]>([]);
  const [merged, setMerged] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      setError(null);
      const next = await syncStore.listConflicts(user.uid);
      setConflicts(next.filter((item) => item.status === "open"));
      setMerged((current) => ({
        ...current,
        ...Object.fromEntries(
          next
            .filter((item) => item.status === "open" && item.entityType === "document")
            .map((item) => [
              item.id,
              current[item.id] ??
                mergeTextThreeWay(
                  asText(item.basePayload?.markdown),
                  asText(item.localPayload.markdown),
                  asText(item.remotePayload.markdown),
                ).text,
            ]),
        ),
      }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Conflictler okunamadı.");
    } finally {
      setLoading(false);
    }
  }, [syncStore, user]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const resolve = async (conflict: LocalConflict, resolution: "local" | "remote" | "merged") => {
    if (!user) return;
    try {
      const payload =
        resolution === "merged"
          ? { ...conflict.remotePayload, markdown: merged[conflict.id] }
          : null;
      await syncStore.resolveConflict(user.uid, conflict.id, resolution, payload, deviceId);
      await load();
    } catch (caught) {
      Alert.alert(
        "Conflict çözülemedi",
        caught instanceof Error ? caught.message : "Lütfen tekrar deneyin.",
      );
    }
  };

  const statusLabel = useMemo(() => {
    if (loading) return "Conflictler yükleniyor";
    return conflicts.length === 0 ? "Açık conflict yok" : `${conflicts.length} açık conflict`;
  }, [conflicts.length, loading]);

  return (
    <Screen>
      <ResponsiveContent>
        <StoneText variant="title1" style={styles.title}>
          Conflict merkezi
        </StoneText>
        {loading ? (
          <LoadingState label={statusLabel} />
        ) : error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : (
          <FlatList
            data={conflicts}
            keyExtractor={(item) => item.id}
            contentContainerStyle={conflicts.length === 0 ? styles.empty : styles.list}
            ListEmptyComponent={
              <EmptyState
                title="Çakışma yok"
                description="Tüm cihaz değişiklikleri güvenle eşitlendi."
              />
            }
            renderItem={({ item }) => (
              <Surface>
                <StoneText variant="title3">
                  {item.entityType} · {item.entityId}
                </StoneText>
                <StoneText variant="caption" style={styles.meta}>
                  Yerel r{item.localRevision} · uzak r{item.remoteRevision}
                </StoneText>
                <StoneText variant="bodySmall" style={styles.preview}>
                  Yerel:{" "}
                  {asText(item.localPayload.title ?? item.localPayload.markdown ?? "—").slice(
                    0,
                    160,
                  )}
                </StoneText>
                <StoneText variant="bodySmall" style={styles.preview}>
                  Uzak:{" "}
                  {asText(item.remotePayload.title ?? item.remotePayload.markdown ?? "—").slice(
                    0,
                    160,
                  )}
                </StoneText>
                {item.entityType === "document" ? (
                  <StoneInput
                    label="Birleştirilmiş Markdown"
                    value={merged[item.id] ?? ""}
                    onChangeText={(value) =>
                      setMerged((current) => ({ ...current, [item.id]: value }))
                    }
                    multiline
                    containerStyle={styles.editor}
                  />
                ) : null}
                <View style={styles.actions}>
                  <StoneButton
                    label="Yereli kullan"
                    variant="quiet"
                    onPress={() => void resolve(item, "local")}
                  />
                  <StoneButton
                    label="Uzağı kullan"
                    variant="secondary"
                    onPress={() => void resolve(item, "remote")}
                  />
                  {item.entityType === "document" ? (
                    <StoneButton label="Birleştir" onPress={() => void resolve(item, "merged")} />
                  ) : null}
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
  title: { marginBottom: spacing.xxl },
  list: { gap: spacing.md, paddingBottom: spacing.giant },
  empty: { flexGrow: 1 },
  meta: { marginTop: spacing.xs },
  preview: { marginTop: spacing.sm },
  editor: { marginTop: spacing.md },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.md },
});

function asText(value: unknown): string {
  return typeof value === "string"
    ? value
    : typeof value === "number" || typeof value === "boolean"
      ? String(value)
      : "";
}
