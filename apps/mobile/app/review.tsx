import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { formatTaskPriority } from "@stone/i18n";
import { ErrorState, LoadingState } from "../src/components/states";
import { ResponsiveContent } from "../src/components/responsive";
import { IconButton, Overline, Screen, StoneText, Surface } from "../src/components/ui";
import { useTheme } from "../src/design/theme";
import { radii, spacing } from "../src/design/tokens";
import { useI18n } from "../src/i18n/provider";
import { useAppServices } from "../src/providers/app-provider";
import { useAuth } from "../src/providers/auth-provider";
import { buildWeeklyReview, localToday, type WeeklyReview } from "../src/review/weekly-review";

/** Last seven days and the next seven at a glance: done, slipped, coming up, focus time. */
export default function WeeklyReviewScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const services = useAppServices();
  const { colors } = useTheme();
  const { t, tp, locale } = useI18n();
  const [review, setReview] = useState<WeeklyReview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      setError(null);
      const today = localToday();
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      const start = new Date(Date.now() - 8 * 86_400_000).toISOString();
      const [tasks, focusSessions, calendarItems] = await Promise.all([
        services.taskUseCases.list(user.uid, { limit: 2_000 }),
        services.focus.list(user.uid, {
          startAt: start,
          endAt: new Date().toISOString(),
          limit: 5_000,
        }),
        services.calendar.listForExport(user.uid),
      ]);
      setReview(buildWeeklyReview({ tasks, focusSessions, calendarItems, today, timezone }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("app.unknownError"));
    }
  }, [services, t, user]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const dayLabel = (date: string) =>
    new Intl.DateTimeFormat(locale, { weekday: "short" }).format(new Date(`${date}T12:00:00`));
  const longDate = (date: string) =>
    new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short" }).format(
      new Date(`${date}T12:00:00`),
    );
  const hours = (seconds: number) =>
    t("review.hours", {
      value: (seconds / 3600).toLocaleString(locale, { maximumFractionDigits: 1 }),
    });

  return (
    <Screen>
      <ResponsiveContent>
        <View style={styles.header}>
          <IconButton
            icon="chevron-back"
            accessibilityLabel={t("common.back")}
            onPress={() => router.back()}
          />
          <StoneText variant="title1">{t("review.title")}</StoneText>
        </View>
        {error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : !review ? (
          <LoadingState />
        ) : (
          <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
            <StoneText variant="bodySmall" tone="secondary">
              {t("review.range", { from: longDate(review.pastStart), to: longDate(review.today) })}
            </StoneText>

            <View style={styles.stats}>
              <Stat label={t("review.completed")} value={String(review.completed.length)} />
              <Stat label={t("review.overdue")} value={String(review.overdue.length)} />
              <Stat label={t("review.focus")} value={hours(review.focusedSeconds)} />
            </View>

            <Surface>
              <Overline>{t("review.focusByDay")}</Overline>
              <View style={styles.chart} accessibilityLabel={t("review.focusByDay")}>
                {review.focusByDay.map((day) => {
                  const max = Math.max(1, ...review.focusByDay.map((entry) => entry.seconds));
                  return (
                    <View
                      key={day.date}
                      style={styles.barColumn}
                      accessible
                      accessibilityLabel={`${dayLabel(day.date)} ${hours(day.seconds)}`}
                    >
                      <View style={styles.barTrack}>
                        <View
                          style={[
                            styles.bar,
                            {
                              height: `${Math.round((day.seconds / max) * 100)}%`,
                              backgroundColor: colors.primary,
                            },
                          ]}
                        />
                      </View>
                      <StoneText variant="caption" tone="secondary">
                        {dayLabel(day.date)}
                      </StoneText>
                    </View>
                  );
                })}
              </View>
              <StoneText variant="caption" tone="secondary">
                {tp("review.sessions", review.focusSessions)}
              </StoneText>
            </Surface>

            <Section title={t("review.overdue")} empty={t("review.nothingOverdue")}>
              {review.overdue.map((task) => (
                <Row
                  key={task.id}
                  title={task.title}
                  detail={`${task.dueDate ?? ""}${task.priority !== "none" ? ` · ${formatTaskPriority(locale, task.priority)}` : ""}`}
                  onPress={() => router.push({ pathname: "/task/[id]", params: { id: task.id } })}
                />
              ))}
            </Section>

            <Section title={t("review.nextWeek")} empty={t("review.nothingNextWeek")}>
              {review.dueNextWeek.map((task) => (
                <Row
                  key={task.id}
                  title={task.title}
                  detail={`${longDate(task.dueDate ?? review.today)}${task.dueTime ? ` ${task.dueTime}` : ""}`}
                  onPress={() => router.push({ pathname: "/task/[id]", params: { id: task.id } })}
                />
              ))}
              {review.upcomingEvents.map((event) => (
                <Row
                  key={event.id}
                  title={event.title}
                  detail={longDate(event.date)}
                  onPress={() =>
                    router.push({ pathname: "/calendar/[id]", params: { id: event.itemId } })
                  }
                />
              ))}
            </Section>

            <Section title={t("review.completed")} empty={t("review.nothingCompleted")}>
              {review.completed.map((task) => (
                <Row
                  key={task.id}
                  title={task.title}
                  detail={task.completedAt ? longDate(localToday(new Date(task.completedAt))) : ""}
                  onPress={() => router.push({ pathname: "/task/[id]", params: { id: task.id } })}
                />
              ))}
            </Section>
          </ScrollView>
        )}
      </ResponsiveContent>
    </Screen>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Surface style={styles.stat}>
      <StoneText variant="title2">{value}</StoneText>
      <StoneText variant="caption" tone="secondary">
        {label}
      </StoneText>
    </Surface>
  );
}

function Section({
  title,
  empty,
  children,
}: {
  title: string;
  empty: string;
  children: ReactNode[];
}) {
  const hasItems = children.flat().some(Boolean);
  return (
    <View style={styles.section}>
      <Overline>{title}</Overline>
      {hasItems ? (
        children
      ) : (
        <StoneText variant="bodySmall" tone="secondary">
          {empty}
        </StoneText>
      )}
    </View>
  );
}

function Row({ title, detail, onPress }: { title: string; detail: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { borderBottomColor: colors.border },
        pressed ? { backgroundColor: colors.surfacePressed } : null,
      ]}
    >
      <StoneText variant="body" numberOfLines={1} style={styles.rowTitle}>
        {title}
      </StoneText>
      <StoneText variant="caption" tone="secondary">
        {detail}
      </StoneText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  page: { gap: spacing.lg, paddingBottom: spacing.giant },
  stats: { flexDirection: "row", gap: spacing.sm },
  stat: { flex: 1, gap: spacing.xxs },
  chart: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.xs,
    height: 120,
    marginVertical: spacing.sm,
  },
  barColumn: { flex: 1, alignItems: "center", gap: spacing.xxs, height: "100%" },
  barTrack: { flex: 1, width: "100%", justifyContent: "flex-end" },
  bar: { width: "100%", borderRadius: radii.sm, minHeight: 2 },
  section: { gap: spacing.xs },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowTitle: { flex: 1 },
});
