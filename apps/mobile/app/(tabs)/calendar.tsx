import * as Crypto from "expo-crypto";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { zonedWallTimeToInstant, type CalendarItem } from "@stone/domain";
import { EmptyState, ErrorState, LoadingState } from "../../src/components/states";
import { ResponsiveContent } from "../../src/components/responsive";
import { Screen, StoneButton, StoneInput, StoneText, Surface } from "../../src/components/ui";
import { spacing } from "../../src/design/tokens";
import { useAppServices } from "../../src/providers/app-provider";
import { useAuth } from "../../src/providers/auth-provider";

export default function CalendarScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { calendar, deviceId } = useAppServices();
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [items, setItems] = useState<readonly CalendarItem[]>([]);
  const [title, setTitle] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      setLoading(true);
      setError(null);
      setItems(await calendar.list(user.uid, { startDate: selectedDate, endDate: selectedDate }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Takvim yüklenemedi.");
    } finally {
      setLoading(false);
    }
  }, [calendar, selectedDate, user]);
  useFocusEffect(useCallback(() => void load(), [load]));

  const create = async () => {
    if (!user || !title.trim()) return;
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const now = new Date().toISOString();
    try {
      await calendar.create({
        schemaVersion: 1,
        id: Crypto.randomUUID(),
        ownerId: user.uid,
        revision: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        updatedByDeviceId: deviceId,
        kind: "event",
        title: title.trim(),
        description: null,
        allDay: false,
        startDate: selectedDate,
        endDate: selectedDate,
        startAt: zonedWallTimeToInstant(selectedDate, startTime, timezone, "earlier"),
        endAt: zonedWallTimeToInstant(selectedDate, endTime, timezone, "later"),
        timezone,
        location: null,
        category: "purple",
        projectId: null,
        sourceDocumentId: null,
        taskId: null,
        planningNote: null,
        recurrence: null,
        recurrenceSeriesId: null,
        recurrenceId: null,
        overrides: [],
        externalUid: null,
        cancelledAt: null,
      });
      setTitle("");
      await load();
    } catch (caught) {
      Alert.alert(
        "Etkinlik oluşturulamadı",
        caught instanceof Error ? caught.message : "Tekrar deneyin.",
      );
    }
  };

  const move = (days: number) => {
    const date = new Date(`${selectedDate}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    setSelectedDate(date.toISOString().slice(0, 10));
  };

  return (
    <Screen padded={false}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.page}>
        <ResponsiveContent>
          <StoneText variant="title1">Takvim ve Ajanda</StoneText>
          <StoneText variant="bodySmall">
            Çevrimdışı çalışır. İşletim sistemi hatırlatması sunulmaz.
          </StoneText>
          <View style={styles.navigation}>
            <StoneButton label="Önceki gün" onPress={() => move(-1)} variant="secondary" />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Seçili gün ${selectedDate}; bugüne dön`}
              onPress={() => setSelectedDate(new Date().toISOString().slice(0, 10))}
            >
              <StoneText variant="title3">{selectedDate}</StoneText>
            </Pressable>
            <StoneButton label="Sonraki gün" onPress={() => move(1)} variant="secondary" />
          </View>
          <Surface>
            <StoneText variant="title3">Hızlı etkinlik</StoneText>
            <StoneInput
              label="Başlık"
              value={title}
              onChangeText={setTitle}
              placeholder="Etkinlik adı"
            />
            <View style={styles.times}>
              <View style={styles.time}>
                <StoneInput
                  label="Başlangıç"
                  value={startTime}
                  onChangeText={setStartTime}
                  placeholder="09:00"
                />
              </View>
              <View style={styles.time}>
                <StoneInput
                  label="Bitiş"
                  value={endTime}
                  onChangeText={setEndTime}
                  placeholder="10:00"
                />
              </View>
            </View>
            <StoneButton
              label="Etkinlik oluştur"
              onPress={() => void create()}
              disabled={!title.trim()}
            />
          </Surface>
          <StoneText variant="title3">Günün ajandası</StoneText>
          {loading ? (
            <LoadingState label="Ajanda yükleniyor" />
          ) : error ? (
            <ErrorState message={error} onRetry={() => void load()} />
          ) : items.length === 0 ? (
            <EmptyState
              title="Bu gün boş"
              description="Etkinlik veya planlanmış çalışma bloğu bulunmuyor."
            />
          ) : (
            items.map((item) => (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={`${item.title} etkinliğini düzenle`}
                onPress={() =>
                  router.push({ pathname: "/calendar/[id]" as never, params: { id: item.id } })
                }
              >
                <Surface>
                  <StoneText variant="caption">
                    {item.kind === "task_block"
                      ? "Zaman bloğu"
                      : item.allDay
                        ? "Tüm gün etkinliği"
                        : "Etkinlik"}
                  </StoneText>
                  <StoneText variant="title3">{item.title}</StoneText>
                  <StoneText variant="bodySmall">
                    {item.allDay
                      ? `${item.startDate} – ${item.endDate}`
                      : `${item.startAt?.slice(11, 16)} – ${item.endAt?.slice(11, 16)} · ${item.timezone}`}
                  </StoneText>
                </Surface>
              </Pressable>
            ))
          )}
        </ResponsiveContent>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: spacing.lg, paddingTop: spacing.xl, paddingBottom: spacing.giant },
  navigation: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    marginVertical: spacing.lg,
  },
  times: { flexDirection: "row", gap: spacing.md },
  time: { flex: 1 },
});
