import * as Crypto from "expo-crypto";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { buildAgendaItems, zonedWallTimeToInstant, type AgendaItem } from "@stone/domain";
import { formatDateOnly, formatInstant } from "@stone/i18n";
import { EmptyState, ErrorState, LoadingState } from "../../src/components/states";
import { ResponsiveContent } from "../../src/components/responsive";
import {
  ActionSheet,
  IconButton,
  ListGroup,
  Overline,
  Screen,
  ScreenHeader,
  StoneButton,
  StoneInput,
  StoneText,
  Surface,
  numeric,
} from "../../src/components/ui";
import { radii, spacing } from "../../src/design/tokens";
import { useTheme } from "../../src/design/theme";
import { useAppServices } from "../../src/providers/app-provider";
import { useAuth } from "../../src/providers/auth-provider";
import {
  commitCalendarIcsImport,
  reviewCalendarIcsImport,
} from "../../src/calendar/calendar-import";
import { pickCalendarIcs, shareCalendarIcs } from "../../src/calendar/calendar-files";
import { useI18n } from "../../src/i18n/provider";
import { calendarSubscriptions } from "../../src/calendar/subscription-service";
import {
  isSubscriptionItemId,
  subscriptionItems,
  type CalendarSubscription,
} from "../../src/calendar/subscriptions";

export default function CalendarScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { calendar, deviceId, taskUseCases, projectUseCases } = useAppServices();
  const { locale, t } = useI18n();
  const { colors } = useTheme();
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [agendaItems, setAgendaItems] = useState<readonly AgendaItem[]>([]);
  const [title, setTitle] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [loading, setLoading] = useState(true);
  const [composing, setComposing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      setLoading(true);
      setError(null);
      const [nextItems, tasks, projects, subscriptions] = await Promise.all([
        calendar.list(user.uid, { startDate: selectedDate, endDate: selectedDate }),
        taskUseCases.list(user.uid),
        projectUseCases.list(user.uid),
        calendarSubscriptions.list(user.uid).catch(() => [] as readonly CalendarSubscription[]),
      ]);
      // Subscribed feeds are shown read-only alongside synced items; they are never saved to them.
      setAgendaItems(
        buildAgendaItems(
          [...nextItems, ...subscriptionItems(subscriptions)],
          tasks,
          projects,
          selectedDate,
          selectedDate,
        ),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("calendar.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [calendar, projectUseCases, selectedDate, taskUseCases, user]);
  useFocusEffect(useCallback(() => void load(), [load]));

  // Refresh stale feeds in the background and redraw once if anything was fetched.
  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      void calendarSubscriptions
        .refresh(user.uid, {
          deviceId,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
          now: new Date().toISOString(),
        })
        .then((subscriptions) => {
          if (subscriptions.length > 0) void load();
        })
        .catch(() => undefined);
    }, [deviceId, load, user]),
  );

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
  const monthLabel = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(
    new Date(`${selectedDate}T12:00:00`),
  );
  const exportIcs = () =>
    user &&
    void shareCalendarIcs(user.uid, calendar).catch((caught: unknown) =>
      Alert.alert(
        t("calendar.exportFailed"),
        caught instanceof Error ? caught.message : t("app.unknownError"),
      ),
    );
  const openItem = (item: AgendaItem) => {
    if (!item.calendarItemId) return;
    if (isSubscriptionItemId(item.calendarItemId)) {
      Alert.alert(item.title, t("subscriptions.readOnlyItem"));
      return;
    }
    router.push({ pathname: "/calendar/[id]", params: { id: item.calendarItemId } });
  };

  return (
    <Screen padded={false}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.page}>
        <ResponsiveContent>
          <ScreenHeader
            title={t("tabs.calendar")}
            subtitle={monthLabel}
            actions={
              <>
                <IconButton
                  icon="today-outline"
                  accessibilityLabel={t("calendar.selectedTodayA11y", {
                    date: formatDateOnly(locale, today, { dateStyle: "full" }),
                  })}
                  onPress={() => setSelectedDate(today)}
                />
                <IconButton
                  icon="ellipsis-horizontal"
                  accessibilityLabel={t("common.more")}
                  onPress={() => setMenuOpen(true)}
                />
                <IconButton
                  icon={composing ? "close" : "add"}
                  tone="accent"
                  active
                  accessibilityLabel={t("calendar.quickEvent")}
                  onPress={() => setComposing((open) => !open)}
                />
              </>
            }
          />

          <View style={styles.weekRow}>
            <IconButton
              icon="chevron-back"
              accessibilityLabel={t("calendar.previousWeek")}
              onPress={() => move(-7)}
            />
            <View style={styles.week} accessibilityRole="tablist">
              {week.map((weekDate) => {
                const selected = weekDate === selectedDate;
                const isToday = weekDate === today;
                return (
                  <Pressable
                    key={weekDate}
                    accessibilityRole="tab"
                    accessibilityState={{ selected }}
                    accessibilityLabel={
                      selected
                        ? t("calendar.selectedA11y", {
                            date: formatDateOnly(locale, weekDate, { dateStyle: "full" }),
                          })
                        : formatDateOnly(locale, weekDate, { dateStyle: "full" })
                    }
                    style={styles.weekDay}
                    onPress={() => setSelectedDate(weekDate)}
                  >
                    <StoneText variant="caption" tone="muted">
                      {formatDateOnly(locale, weekDate, { weekday: "narrow" })}
                    </StoneText>
                    <View
                      style={[styles.dayNumber, selected && { backgroundColor: colors.primary }]}
                    >
                      <StoneText
                        variant="label"
                        style={[
                          numeric,
                          {
                            color: selected
                              ? colors.onPrimary
                              : isToday
                                ? colors.primaryText
                                : colors.text,
                          },
                        ]}
                      >
                        {formatDateOnly(locale, weekDate, { day: "numeric" })}
                      </StoneText>
                    </View>
                  </Pressable>
                );
              })}
            </View>
            <IconButton
              icon="chevron-forward"
              accessibilityLabel={t("calendar.nextWeek")}
              onPress={() => move(7)}
            />
          </View>

          {composing ? (
            <Surface style={styles.composer}>
              <StoneInput
                label={t("calendar.titleField")}
                value={title}
                onChangeText={setTitle}
                placeholder={t("calendar.titlePlaceholder")}
                autoFocus
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
                onPress={() => void create().then(() => setComposing(false))}
                disabled={!title.trim()}
              />
            </Surface>
          ) : null}

          <View style={styles.dayHeader}>
            <Overline>
              {formatDateOnly(locale, selectedDate, {
                weekday: "long",
                day: "numeric",
                month: "long",
              })}
            </Overline>
            {selectedDate === today ? (
              <StoneText variant="caption" tone="accent" accessibilityLiveRegion="polite">
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
          </View>
          {loading && agendaItems.length === 0 ? (
            <LoadingState label={t("calendar.agendaLoading")} />
          ) : error ? (
            <ErrorState message={error} onRetry={() => void load()} />
          ) : agendaItems.length === 0 ? (
            <EmptyState
              icon="calendar-clear-outline"
              title={t("calendar.emptyDay")}
              description={t("calendar.emptyDayDetail")}
            />
          ) : (
            <ListGroup>
              {agendaItems.map((item) => (
                <Pressable
                  key={item.id}
                  accessibilityRole={item.calendarItemId ? "button" : undefined}
                  accessibilityLabel={`${agendaKindLabel(item.kind, t)} ${item.title}`}
                  disabled={!item.calendarItemId}
                  onPress={() => openItem(item)}
                  style={({ pressed }) => [
                    styles.agendaRow,
                    pressed && { backgroundColor: colors.surfacePressed },
                  ]}
                >
                  <StoneText variant="label" tone="secondary" style={[styles.agendaTime, numeric]}>
                    {item.sortTime ?? t("calendar.allDay")}
                  </StoneText>
                  <View
                    style={[
                      styles.agendaBar,
                      {
                        backgroundColor:
                          item.calendarItemId && isSubscriptionItemId(item.calendarItemId)
                            ? colors.borderStrong
                            : colors.primary,
                      },
                    ]}
                  />
                  <View style={styles.agendaBody}>
                    <StoneText
                      variant="body"
                      numberOfLines={1}
                      tone={item.completed ? "muted" : "default"}
                    >
                      {item.title}
                    </StoneText>
                    <StoneText variant="caption" tone="muted">
                      {agendaKindLabel(item.kind, t)}
                      {item.completed ? ` · ${t("tasks.completed")}` : ""}
                    </StoneText>
                  </View>
                </Pressable>
              ))}
            </ListGroup>
          )}
        </ResponsiveContent>
      </ScrollView>
      <ActionSheet
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        options={[
          {
            label: t("subscriptions.title"),
            icon: "link-outline",
            onPress: () => router.push("/calendar/subscriptions"),
          },
          {
            label: t("calendar.importIcs"),
            icon: "download-outline",
            onPress: () => void importIcs(),
          },
          { label: t("calendar.exportIcs"), icon: "share-outline", onPress: exportIcs },
        ]}
      />
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
  page: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.giant },
  weekRow: { flexDirection: "row", alignItems: "center", marginHorizontal: -spacing.sm },
  week: { flex: 1, flexDirection: "row" },
  weekDay: { flex: 1, alignItems: "center", gap: spacing.xs, paddingVertical: spacing.xs },
  dayNumber: {
    width: 34,
    height: 34,
    borderRadius: radii.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  composer: { gap: spacing.md, marginTop: spacing.md },
  dayHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  agendaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 56,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  agendaTime: { width: 60 },
  agendaBar: { width: 3, height: 32, borderRadius: radii.pill },
  agendaBody: { flex: 1, gap: 2 },
  times: { flexDirection: "row", gap: spacing.md },
  time: { flex: 1 },
});
