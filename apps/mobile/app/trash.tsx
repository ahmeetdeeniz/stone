import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, FlatList, StyleSheet, View } from "react-native";
import type { Document } from "@stone/domain";
import { ErrorState, EmptyState, LoadingState } from "../src/components/states";
import { ResponsiveContent } from "../src/components/responsive";
import { IconButton, Screen, StoneButton, StoneText, Surface } from "../src/components/ui";
import { spacing } from "../src/design/tokens";
import { useAuth } from "../src/providers/auth-provider";
import { useAppServices } from "../src/providers/app-provider";
import { useI18n } from "../src/i18n/provider";
import { formatInstant } from "@stone/i18n";

export default function TrashScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { noteUseCases, deviceId } = useAppServices();
  const { locale, t } = useI18n();
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
      setError(caught instanceof Error ? caught.message : t("trash.loadFailed"));
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
    Alert.alert(t("trash.deleteConfirm"), t("trash.deleteWarning"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.permanentlyDelete"),
        style: "destructive",
        onPress: () => void noteUseCases.permanentlyDelete(user.uid, note.id, deviceId).then(load),
      },
    ]);
  };

  return (
    <Screen>
      <ResponsiveContent>
        <View style={styles.header}>
          <IconButton
            icon="chevron-back"
            accessibilityLabel={t("common.back")}
            onPress={() => router.back()}
          />
          <StoneText variant="title1">{t("trash.title")}</StoneText>
        </View>
        {loading ? (
          <LoadingState label={t("trash.loading")} />
        ) : error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : (
          <FlatList
            data={notes}
            keyExtractor={(item) => item.id}
            contentContainerStyle={notes.length === 0 ? styles.empty : styles.list}
            ListEmptyComponent={
              <EmptyState
                icon="trash-outline"
                title={t("trash.empty")}
                description={t("trash.emptyDetail")}
              />
            }
            renderItem={({ item }) => (
              <Surface>
                <StoneText variant="title3" numberOfLines={1}>
                  {item.title}
                </StoneText>
                <StoneText variant="caption" tone="muted" style={styles.deleted}>
                  {t("common.deletedAt", {
                    date: item.deletedAt
                      ? formatInstant(
                          locale,
                          item.deletedAt,
                          Intl.DateTimeFormat().resolvedOptions().timeZone,
                        )
                      : "—",
                  })}
                </StoneText>
                <View style={styles.actions}>
                  <StoneButton
                    label={t("common.restore")}
                    variant="secondary"
                    icon="arrow-undo-outline"
                    size="sm"
                    onPress={() =>
                      void noteUseCases.restore(user!.uid, item.id, deviceId).then(load)
                    }
                  />
                  <StoneButton
                    label={t("common.permanentlyDelete")}
                    variant="danger"
                    size="sm"
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
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginLeft: -spacing.sm,
    marginBottom: spacing.lg,
  },
  list: { gap: spacing.md, paddingBottom: spacing.giant },
  empty: { flexGrow: 1 },
  deleted: { marginTop: spacing.sm },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
});
