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
import { useI18n } from "../src/i18n/provider";

export default function ConflictsScreen() {
  const { user } = useAuth();
  const { syncStore, deviceId } = useAppServices();
  const { t, tp } = useI18n();
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
      setError(caught instanceof Error ? caught.message : t("conflicts.loadFailed"));
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
        t("conflicts.resolveFailed"),
        caught instanceof Error ? caught.message : t("app.unknownError"),
      );
    }
  };

  const statusLabel = useMemo(() => {
    if (loading) return t("conflicts.loading");
    return conflicts.length === 0
      ? t("conflicts.open.none")
      : tp("conflicts.open", conflicts.length);
  }, [conflicts.length, loading, t, tp]);

  return (
    <Screen>
      <ResponsiveContent>
        <StoneText variant="title1" style={styles.title}>
          {t("conflicts.title")}
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
              <EmptyState title={t("conflicts.empty")} description={t("conflicts.emptyDetail")} />
            }
            renderItem={({ item }) => (
              <Surface>
                <StoneText variant="title3">
                  {item.entityType} · {item.entityId}
                </StoneText>
                <StoneText variant="caption" style={styles.meta}>
                  {t("conflicts.localRemoteRevision", {
                    local: item.localRevision,
                    remote: item.remoteRevision,
                  })}
                </StoneText>
                <StoneText variant="bodySmall" style={styles.preview}>
                  {t("conflicts.local")}:{" "}
                  {asText(item.localPayload.title ?? item.localPayload.markdown ?? "—").slice(
                    0,
                    160,
                  )}
                </StoneText>
                <StoneText variant="bodySmall" style={styles.preview}>
                  {t("conflicts.remote")}:{" "}
                  {asText(item.remotePayload.title ?? item.remotePayload.markdown ?? "—").slice(
                    0,
                    160,
                  )}
                </StoneText>
                {item.entityType === "document" ? (
                  <StoneInput
                    label={t("conflicts.mergedMarkdown")}
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
                    label={t("conflicts.useLocal")}
                    variant="quiet"
                    onPress={() => void resolve(item, "local")}
                  />
                  <StoneButton
                    label={t("conflicts.useRemote")}
                    variant="secondary"
                    onPress={() => void resolve(item, "remote")}
                  />
                  {item.entityType === "document" ? (
                    <StoneButton
                      label={t("conflicts.merge")}
                      onPress={() => void resolve(item, "merged")}
                    />
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
