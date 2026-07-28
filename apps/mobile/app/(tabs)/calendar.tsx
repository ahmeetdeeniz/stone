import * as Crypto from "expo-crypto";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { buildAgendaItems, zonedWallTimeToInstant, type AgendaItem } from "@stone/domain";
import { EmptyState, ErrorState, LoadingState } from "../../src/components/states";
import { ResponsiveContent } from "../../src/components/responsive";
import { Screen, StoneButton, StoneInput, StoneText, Surface } from "../../src/components/ui";
import { colors, spacing } from "../../src/design/tokens";
import { useAppServices } from "../../src/providers/app-provider";
import { useAuth } from "../../src/providers/auth-provider";

export default function CalendarScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { calendar, deviceId, taskUseCases, projectUseCases } = useAppServices();
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [agendaItems, setAgendaItems] = useState<readonly AgendaItem[]>([]);
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
      const [nextItems, tasks, projects] = await Promise.all([
        calendar.list(user.uid, { startDate: selectedDate, endDate: selectedDate }),
        taskUseCases.list(user.uid),
        projectUseCases.list(user.uid),
      ]);
      setAgendaItems(buildAgendaItems(nextItems, tasks, projects, selectedDate, selectedDate));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Takvim yüklenemedi.");
    } finally {
      setLoading(false);
    }
  }, [calendar, projectUseCases, selectedDate, taskUseCases, user]);
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
  const week = Array.from({ length: 7 }, (_, offset) => {
    const date = new Date(`${selectedDate}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7) + offset);
    return date.toISOString().slice(0, 10);
  });

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
          <View style={styles.week} accessibilityRole="tablist">
            {week.map((weekDate) => (
              <Pressable
                key={weekDate}
                accessibilityRole="tab"
                accessibilityState={{ selected: weekDate === selectedDate }}
                accessibilityLabel={`${weekDate}${weekDate === selectedDate ? ", seçili" : ""}`}
                style={[styles.weekDay, weekDate === selectedDate && styles.weekDaySelected]}
                onPress={() => setSelectedDate(weekDate)}
              >
                <StoneText variant="caption">{weekDate.slice(8)}</StoneText>
              </Pressable>
            ))}
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
          ) : agendaItems.length === 0 ? (
            <EmptyState
              title="Bu gün boş"
              description="Etkinlik veya planlanmış çalışma bloğu bulunmuyor."
            />
          ) : (
            agendaItems.map((item) => (
              <Pressable
                key={item.id}
                accessibilityRole={item.calendarItemId ? "button" : undefined}
                accessibilityLabel={`${agendaKindLabel(item.kind)} ${item.title}`}
                disabled={!item.calendarItemId}
                onPress={() =>
                  item.calendarItemId &&
                  router.push({
                    pathname: "/calendar/[id]" as never,
                    params: { id: item.calendarItemId },
                  })
                }
              >
                <Surface>
                  <StoneText variant="caption">{agendaKindLabel(item.kind)}</StoneText>
                  <StoneText variant="title3">{item.title}</StoneText>
                  <StoneText variant="bodySmall">
                    {item.sortTime ?? "Tüm gün"}
                    {item.completed ? " · Tamamlandı" : ""}
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

function agendaKindLabel(kind: AgendaItem["kind"]): string {
  return {
    event: "Etkinlik",
    task_block: "Zaman bloğu",
    task_due: "Görev son tarihi",
    project_milestone: "Proje hedef tarihi",
  }[kind];
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
  week: { flexDirection: "row", gap: spacing.xs, marginBottom: spacing.lg },
  weekDay: {
    flex: 1,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
  },
  weekDaySelected: { borderWidth: 2, borderColor: colors.brand.purple600 },
  times: { flexDirection: "row", gap: spacing.md },
  time: { flex: 1 },
});
