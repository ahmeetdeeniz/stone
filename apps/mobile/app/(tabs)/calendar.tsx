import * as Crypto from "expo-crypto";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { buildAgendaItems, zonedWallTimeToInstant, type AgendaItem } from "@stone/domain";
import { formatDateOnly, formatInstant } from "@stone/i18n";
import { EmptyState, ErrorState, LoadingState } from "../../src/components/states";
import { ResponsiveContent } from "../../src/components/responsive";
import { Screen, StoneButton, StoneInput, StoneText, Surface } from "../../src/components/ui";
import { colors, spacing } from "../../src/design/tokens";
import { useAppServices } from "../../src/providers/app-provider";
import { useAuth } from "../../src/providers/auth-provider";
import {
  commitCalendarIcsImport,
  reviewCalendarIcsImport,
} from "../../src/calendar/calendar-import";
import { pickCalendarIcs, shareCalendarIcs } from "../../src/calendar/calendar-files";
import { useI18n } from "../../src/i18n/provider";

export default function CalendarScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { calendar, deviceId, taskUseCases, projectUseCases } = useAppServices();
  const { locale, t } = useI18n();
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
      setError(caught instanceof Error ? caught.message : t("calendar.loadFailed"));
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
        t("calendar.createFailed"),
        caught instanceof Error ? caught.message : t("app.unknownError"),
      );
    }
  };

  const move = (days: number) => {
    const date = new Date(`${selectedDate}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    setSelectedDate(date.toISOString().slice(0, 10));
  };
  const importIcs = async () => {
    if (!user) return;
    try {
      const source = await pickCalendarIcs();
      if (source === null) return;
      const review = await reviewCalendarIcsImport(
        source,
        {
          ownerId: user.uid,
          deviceId,
          now: new Date().toISOString(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        },
        calendar,
      );
      const commit = async (confirmed: boolean) => {
        const imported = await commitCalendarIcsImport(review, calendar, confirmed);
        Alert.alert(
          t("calendar.imported"),
          t("calendar.importSummary", {
            created: imported.length,
            duplicates: review.duplicates,
          }),
        );
        await load();
      };
      if (!review.requiresConfirmation) {
        await commit(false);
        return;
      }
      Alert.alert(
        t("calendar.largeImport"),
        t("calendar.largeImportDetail", {
          created: review.newItems,
          duplicates: review.duplicates,
        }),
        [
          { text: t("common.cancel"), style: "cancel" },
          { text: t("common.import"), onPress: () => void commit(true) },
        ],
      );
    } catch (caught) {
      Alert.alert(
        t("calendar.importFailed"),
        caught instanceof Error ? caught.message : t("app.unknownError"),
      );
    }
  };
  const week = Array.from({ length: 7 }, (_, offset) => {
    const date = new Date(`${selectedDate}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7) + offset);
    return date.toISOString().slice(0, 10);
  });
  const today = new Date().toISOString().slice(0, 10);

  return (
    <Screen padded={false}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.page}>
        <ResponsiveContent>
          <StoneText variant="title1">{t("calendar.title")}</StoneText>
          <StoneText variant="bodySmall">{t("calendar.offlineNoReminder")}</StoneText>
          <View style={styles.fileActions}>
            <StoneButton
              label={t("calendar.importIcs")}
              variant="secondary"
              onPress={() => void importIcs()}
            />
            <StoneButton
              label={t("calendar.exportIcs")}
              variant="secondary"
              onPress={() =>
                user &&
                void shareCalendarIcs(user.uid, calendar).catch((caught: unknown) =>
                  Alert.alert(
                    t("calendar.exportFailed"),
                    caught instanceof Error ? caught.message : t("app.unknownError"),
                  ),
                )
              }
            />
          </View>
          <View style={styles.navigation}>
            <StoneButton
              label={t("calendar.previousDay")}
              onPress={() => move(-1)}
              variant="secondary"
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("calendar.selectedTodayA11y", {
                date: formatDateOnly(locale, selectedDate, { dateStyle: "full" }),
              })}
              onPress={() => setSelectedDate(new Date().toISOString().slice(0, 10))}
            >
              <StoneText variant="title3">
                {formatDateOnly(locale, selectedDate, { dateStyle: "full" })}
              </StoneText>
            </Pressable>
            <StoneButton
              label={t("calendar.nextDay")}
              onPress={() => move(1)}
              variant="secondary"
            />
          </View>
          <View style={styles.week} accessibilityRole="tablist">
            {week.map((weekDate) => (
              <Pressable
                key={weekDate}
                accessibilityRole="tab"
                accessibilityState={{ selected: weekDate === selectedDate }}
                accessibilityLabel={
                  weekDate === selectedDate
                    ? t("calendar.selectedA11y", {
                        date: formatDateOnly(locale, weekDate, { dateStyle: "full" }),
                      })
                    : formatDateOnly(locale, weekDate, { dateStyle: "full" })
                }
                style={[styles.weekDay, weekDate === selectedDate && styles.weekDaySelected]}
                onPress={() => setSelectedDate(weekDate)}
              >
                <StoneText variant="caption">
                  {formatDateOnly(locale, weekDate, { weekday: "narrow", day: "numeric" })}
                </StoneText>
              </Pressable>
            ))}
          </View>
          {selectedDate === today ? (
            <StoneText variant="caption" accessibilityLiveRegion="polite">
              {t("calendar.now", {
                time: formatInstant(
                  locale,
                  new Date(),
                  Intl.DateTimeFormat().resolvedOptions().timeZone,
                  { hour: "2-digit", minute: "2-digit" },
                ),
              })}
            </StoneText>
          ) : null}
          <Surface>
            <StoneText variant="title3">{t("calendar.quickEvent")}</StoneText>
            <StoneInput
              label={t("calendar.titleField")}
              value={title}
              onChangeText={setTitle}
              placeholder={t("calendar.titlePlaceholder")}
            />
            <View style={styles.times}>
              <View style={styles.time}>
                <StoneInput
                  label={t("calendar.start")}
                  value={startTime}
                  onChangeText={setStartTime}
                  placeholder="09:00"
                />
              </View>
              <View style={styles.time}>
                <StoneInput
                  label={t("calendar.end")}
                  value={endTime}
                  onChangeText={setEndTime}
                  placeholder="10:00"
                />
              </View>
            </View>
            <StoneButton
              label={t("calendar.createEvent")}
              onPress={() => void create()}
              disabled={!title.trim()}
            />
          </Surface>
          <StoneText variant="title3">{t("calendar.dayAgenda")}</StoneText>
          {loading ? (
            <LoadingState label={t("calendar.agendaLoading")} />
          ) : error ? (
            <ErrorState message={error} onRetry={() => void load()} />
          ) : agendaItems.length === 0 ? (
            <EmptyState title={t("calendar.emptyDay")} description={t("calendar.emptyDayDetail")} />
          ) : (
            agendaItems.map((item) => (
              <Pressable
                key={item.id}
                accessibilityRole={item.calendarItemId ? "button" : undefined}
                accessibilityLabel={`${agendaKindLabel(item.kind, t)} ${item.title}`}
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
                  <StoneText variant="caption">{agendaKindLabel(item.kind, t)}</StoneText>
                  <StoneText variant="title3">{item.title}</StoneText>
                  <StoneText variant="bodySmall">
                    {item.sortTime ?? t("calendar.allDay")}
                    {item.completed ? ` · ${t("tasks.completed")}` : ""}
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

function agendaKindLabel(kind: AgendaItem["kind"], t: ReturnType<typeof useI18n>["t"]): string {
  return {
    event: t("calendar.event"),
    task_block: t("calendar.taskBlock"),
    task_due: t("calendar.taskDue"),
    project_milestone: t("calendar.projectTargetDate"),
  }[kind];
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: spacing.lg, paddingTop: spacing.xl, paddingBottom: spacing.giant },
  fileActions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.md },
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
