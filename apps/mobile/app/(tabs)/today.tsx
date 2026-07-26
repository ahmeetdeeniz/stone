import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, FlatList, Pressable, StyleSheet, View } from "react-native";
import type { TodayItem } from "@stone/domain";
import { ResponsiveContent } from "../../src/components/responsive";
import { EmptyState, ErrorState, LoadingState } from "../../src/components/states";
import { Screen, StoneButton, StoneInput, StoneText, Surface } from "../../src/components/ui";
import { spacing } from "../../src/design/tokens";
import { useAuth } from "../../src/providers/auth-provider";
import { useAppServices } from "../../src/providers/app-provider";

export default function TodayScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { projectUseCases, deviceId } = useAppServices();
  const [items, setItems] = useState<readonly TodayItem[]>([]);
  const [capture, setCapture] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      setError(null);
      setItems(await projectUseCases.today(user.uid, new Date().toISOString()));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Bugün görünümü yüklenemedi.");
    } finally {
      setLoading(false);
    }
  }, [projectUseCases, user]);

  useFocusEffect(useCallback(() => void load(), [load]));

  const quickCapture = async () => {
    if (!user || !capture.trim()) return;
    try {
      await projectUseCases.addInboxItem(user.uid, capture, deviceId);
      setCapture("");
      Alert.alert("Inbox'e eklendi", "Yakalama yerel olarak kaydedildi.");
    } catch (caught) {
      Alert.alert(
        "Yakalama başarısız",
        caught instanceof Error ? caught.message : "Tekrar deneyin.",
      );
    }
  };

  const toggle = async (item: TodayItem) => {
    if (!user || !item.taskId) return;
    try {
      await projectUseCases.toggleTask(user.uid, item.taskId, true, deviceId);
      await load();
    } catch (caught) {
      Alert.alert(
        "Görev güncellenemedi",
        caught instanceof Error ? caught.message : "Tekrar deneyin.",
      );
    }
  };

  return (
    <Screen>
      <ResponsiveContent>
        <StoneText variant="title1" style={{ marginBottom: spacing.xs }}>
          Bugün
        </StoneText>
        <StoneText variant="bodySmall" style={{ marginBottom: spacing.lg }}>
          Öncelik, tarih, blocker ve proje sinyallerinin sakin özeti.
        </StoneText>
        <View style={styles.capture}>
          <StoneInput
            label="Hızlı Inbox yakalama"
            value={capture}
            onChangeText={setCapture}
            placeholder="Aklındaki fikri yaz"
            onSubmitEditing={() => void quickCapture()}
          />
          <StoneButton
            label="Inbox'e ekle"
            variant="secondary"
            onPress={() => void quickCapture()}
            disabled={!capture.trim()}
          />
        </View>
        {loading ? (
          <LoadingState label="Bugün yükleniyor" />
        ) : error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : (
          <FlatList
            data={items}
            keyExtractor={(item) => item.id}
            contentContainerStyle={items.length === 0 ? styles.empty : styles.list}
            ListEmptyComponent={
              <EmptyState
                title="Bugün sakin"
                description="Gecikmiş, acil veya bekleyen proje işi yok."
              />
            }
            renderItem={({ item }) => (
              <Surface>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${item.projectTitle} projesini aç`}
                  onPress={() =>
                    router.push({ pathname: "/project/[id]", params: { id: item.projectId } })
                  }
                >
                  <StoneText variant="caption">
                    {kindLabel(item.kind)} · {item.projectTitle}
                  </StoneText>
                  <StoneText variant="body">{item.text}</StoneText>
                  <StoneText variant="caption" style={{ marginTop: spacing.xs }}>
                    {item.priority ? `Öncelik: ${item.priority}` : ""}
                    {item.dueDate ? ` · Tarih: ${item.dueDate}` : ""}
                    {item.blocked ? " · Blocker" : ""}
                  </StoneText>
                </Pressable>
                {item.taskId ? (
                  <StoneButton
                    label="Tamamlandı"
                    variant="quiet"
                    onPress={() => void toggle(item)}
                  />
                ) : null}
              </Surface>
            )}
          />
        )}
      </ResponsiveContent>
    </Screen>
  );
}

function kindLabel(kind: TodayItem["kind"]): string {
  return kind === "task" ? "Görev" : kind === "next_action" ? "Sonraki iş" : "Proje sinyali";
}

const styles = StyleSheet.create({
  capture: { gap: spacing.sm, marginBottom: spacing.lg },
  list: { gap: spacing.md, paddingBottom: spacing.giant },
  empty: { flexGrow: 1 },
});
