import * as Crypto from "expo-crypto";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import {
  buildAgendaItems,
  type AgendaItem,
  type Task,
  type TaskListOptions,
  type TodayItem,
} from "@stone/domain";
import { formatTaskPriority } from "@stone/i18n";
import { ResponsiveContent } from "../../src/components/responsive";
import { EmptyState, ErrorState, LoadingState } from "../../src/components/states";
import {
  Badge,
  Card,
  Chip,
  IconButton,
  Overline,
  Screen,
  ScreenHeader,
  SearchField,
  StoneText,
  Surface,
} from "../../src/components/ui";
import { hairline, radii, spacing, typography, touchTarget } from "../../src/design/tokens";
import type { StatusTone } from "../../src/design/tokens";
import { useTheme } from "../../src/design/theme";
import { useAuth } from "../../src/providers/auth-provider";
import { useAppServices } from "../../src/providers/app-provider";
import { useI18n } from "../../src/i18n/provider";

type ViewFilter = "all" | "today" | "upcoming" | "overdue" | "completed";

const agendaIcons: Readonly<
  Record<
    AgendaItem["kind"],
    "calendar-outline" | "timer-outline" | "flag-outline" | "rocket-outline"
  >
> = {
  event: "calendar-outline",
  task_block: "timer-outline",
  task_due: "flag-outline",
  project_milestone: "rocket-outline",
};

export default function TodayScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { taskUseCases, projectUseCases, calendar, deviceId } = useAppServices();
  const { t, tp } = useI18n();
  const filterLabels: Readonly<Record<ViewFilter, string>> = {
    all: t("common.all"),
    today: t("tasks.today"),
    upcoming: t("tasks.upcoming"),
    overdue: t("tasks.overdue"),
    completed: t("tasks.completed"),
  };
  const [tasks, setTasks] = useState<readonly Task[]>([]);
  const [signals, setSignals] = useState<readonly TodayItem[]>([]);
  const [agendaItems, setAgendaItems] = useState<readonly AgendaItem[]>([]);
  const [capture, setCapture] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ViewFilter>("today");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const today = new Date().toISOString().slice(0, 10);
  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      setError(null);
      const options: TaskListOptions =
        filter === "completed"
          ? { state: "completed", search }
          : filter === "all"
            ? { state: "open", search }
            : { state: "open", due: filter, today, search };
      const [nextTasks, nextSignals, nextCalendar] = await Promise.all([
        taskUseCases.list(user.uid, options),
        projectUseCases.today(user.uid, new Date().toISOString()),
        calendar.list(user.uid, { startDate: today, endDate: today }),
      ]);
      setTasks(nextTasks);
      setSignals(nextSignals.filter((item) => item.kind !== "task"));
      setAgendaItems(buildAgendaItems(nextCalendar, [], [], today, today));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("tasks.loadPlanningFailed"));
    } finally {
      setLoading(false);
    }
  }, [calendar, filter, projectUseCases, search, taskUseCases, today, user]);

  useFocusEffect(useCallback(() => void load(), [load]));

  const quickAdd = async () => {
    if (!user || !capture.trim()) return;
    const now = new Date().toISOString();
    try {
      await taskUseCases.create({
        schemaVersion: 1,
        id: Crypto.randomUUID(),
        ownerId: user.uid,
        title: capture.trim(),
        description: null,
        state: "open",
        completedAt: null,
        dueDate: filter === "today" ? today : null,
        dueTime: null,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        priority: "none",
        sortOrder: Date.now(),
        tags: [],
        projectId: null,
        sourceDocumentId: null,
        sourceBlockId: null,
        parentTaskId: null,
        estimatedMinutes: null,
        recurrence: null,
        recurrenceSeriesId: null,
        occurrenceDate: null,
        revision: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        updatedByDeviceId: deviceId,
      });
      setCapture("");
      await load();
    } catch (caught) {
      Alert.alert(t("tasks.addFailed"), message(caught, t("app.unknownError")));
    }
  };

  const toggle = async (task: Task) => {
    if (!user) return;
    try {
      if (task.state === "completed") await taskUseCases.reopen(user.uid, task.id, deviceId);
      else await taskUseCases.complete(user.uid, task.id, new Date().toISOString(), deviceId);
      await load();
    } catch (caught) {
      Alert.alert(t("tasks.updateFailed"), message(caught, t("app.unknownError")));
    }
  };

  const subtitle = useMemo(() => tp("planning.subtitle", tasks.length), [tasks.length, tp]);

  return (
    <Screen padded={false}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.page}
      >
        <ResponsiveContent>
          <ScreenHeader title={t("planning.title")} subtitle={subtitle} />

          <QuickCapture
            value={capture}
            onChangeText={setCapture}
            onSubmit={() => void quickAdd()}
            placeholder={t("tasks.quickAddPlaceholder")}
            accessibilityLabel={t("tasks.quickAdd")}
            addLabel={t("tasks.add")}
          />

          <SearchField
            value={search}
            onChangeText={setSearch}
            placeholder={t("tasks.searchPlaceholder")}
            accessibilityLabel={t("tasks.search")}
            onClear={() => setSearch("")}
          />

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filters}
          >
            {(Object.keys(filterLabels) as ViewFilter[]).map((value) => (
              <Chip
                key={value}
                label={filterLabels[value]}
                selected={filter === value}
                onPress={() => setFilter(value)}
                accessibilityLabel={t("tasks.showFilter", { filter: filterLabels[value] })}
              />
            ))}
          </ScrollView>

          {filter === "today" && agendaItems.length > 0 ? (
            <View style={styles.section}>
              <Overline>{t("tasks.timelineToday")}</Overline>
              <Surface padded={false} style={styles.timeline}>
                {agendaItems.map((item, index) => (
                  <View key={item.id}>
                    {index > 0 ? <TimelineDivider /> : null}
                    <AgendaRow item={item} />
                  </View>
                ))}
              </Surface>
            </View>
          ) : null}

          <View style={styles.section}>
            {loading ? (
              <LoadingState label={t("tasks.loading")} />
            ) : error ? (
              <ErrorState message={error} onRetry={() => void load()} />
            ) : tasks.length === 0 ? (
              <EmptyState
                icon="checkmark-done-outline"
                title={t("tasks.emptyFilter")}
                description={t("tasks.emptyFilterDetail")}
              />
            ) : (
              <Surface padded={false} style={styles.timeline}>
                {tasks.map((task, index) => (
                  <View key={task.id}>
                    {index > 0 ? <TimelineDivider /> : null}
                    <TaskRow
                      task={task}
                      onToggle={() => void toggle(task)}
                      onOpen={() =>
                        router.push({ pathname: "/task/[id]", params: { id: task.id } })
                      }
                    />
                  </View>
                ))}
              </Surface>
            )}
          </View>

          {filter === "today" && signals.length > 0 ? (
            <View style={styles.section}>
              <Overline>{t("tasks.projectSignals")}</Overline>
              {signals.map((item) => (
                <Card
                  key={item.id}
                  accessibilityLabel={t("tasks.openProjectA11y", { title: item.projectTitle })}
                  onPress={() =>
                    router.push({ pathname: "/project/[id]", params: { id: item.projectId } })
                  }
                >
                  <View style={styles.signalHead}>
                    <StoneText variant="caption" tone="accent" numberOfLines={1}>
                      {item.projectTitle}
                    </StoneText>
                    {item.blocked ? <Badge label={t("tasks.blocker")} tone="danger" /> : null}
                  </View>
                  <StoneText variant="body" numberOfLines={2}>
                    {item.text}
                  </StoneText>
                  <StoneText variant="caption" tone="muted" style={styles.signalMeta}>
                    {item.dueDate ?? t("tasks.noDate")}
                  </StoneText>
                </Card>
              ))}
            </View>
          ) : null}
        </ResponsiveContent>
      </ScrollView>
    </Screen>
  );
}

/** One-line capture bar: type, hit the round button, keep going. */
function QuickCapture({
  value,
  onChangeText,
  onSubmit,
  placeholder,
  accessibilityLabel,
  addLabel,
}: {
  value: string;
  onChangeText: (value: string) => void;
  onSubmit: () => void;
  placeholder: string;
  accessibilityLabel: string;
  addLabel: string;
}) {
  const { colors, elevation } = useTheme();
  const ready = value.trim().length > 0;
  return (
    <View
      style={[
        styles.capture,
        { backgroundColor: colors.surface, borderColor: colors.border },
        elevation.sm,
      ]}
    >
      <Ionicons name="add-circle-outline" size={20} color={colors.primary} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        accessibilityLabel={accessibilityLabel}
        returnKeyType="done"
        onSubmitEditing={onSubmit}
        style={[styles.captureInput, { color: colors.text }]}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={addLabel}
        accessibilityState={{ disabled: !ready }}
        disabled={!ready}
        onPress={onSubmit}
        style={({ pressed }) => [
          styles.captureAction,
          {
            backgroundColor: ready
              ? pressed
                ? colors.primaryPressed
                : colors.primary
              : colors.surfaceSunken,
          },
        ]}
      >
        <Ionicons name="arrow-up" size={18} color={ready ? colors.onPrimary : colors.textMuted} />
      </Pressable>
    </View>
  );
}

function TimelineDivider() {
  const { colors } = useTheme();
  return <View style={[styles.rowDivider, { backgroundColor: colors.border }]} />;
}

function AgendaRow({ item }: { item: AgendaItem }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  return (
    <View style={styles.agendaRow}>
      <View style={[styles.agendaIcon, { backgroundColor: colors.primarySoft }]}>
        <Ionicons name={agendaIcons[item.kind]} size={16} color={colors.primaryText} />
      </View>
      <View style={styles.rowBody}>
        <StoneText variant="body" numberOfLines={1}>
          {item.title}
        </StoneText>
        <StoneText variant="caption" tone="muted">
          {agendaLabel(item.kind, t)} · {item.sortTime ?? t("calendar.allDay")}
        </StoneText>
      </View>
      {item.completed ? (
        <Ionicons name="checkmark-circle" size={18} color={colors.textMuted} />
      ) : null}
    </View>
  );
}

function agendaLabel(kind: AgendaItem["kind"], t: ReturnType<typeof useI18n>["t"]): string {
  return {
    event: t("calendar.event"),
    task_block: t("calendar.scheduledTaskBlock"),
    task_due: t("calendar.taskDue"),
    project_milestone: t("calendar.projectTargetDate"),
  }[kind];
}

const priorityTone: Readonly<Record<Task["priority"], StatusTone>> = {
  none: "neutral",
  low: "neutral",
  medium: "info",
  high: "danger",
};

function TaskRow({
  task,
  onToggle,
  onOpen,
}: {
  task: Task;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const completed = task.state === "completed";
  const { colors } = useTheme();
  const { locale, t } = useI18n();
  return (
    <View style={styles.taskRow}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: completed }}
        accessibilityLabel={t("tasks.toggleA11y", {
          title: task.title,
          action: completed ? t("a11y.task.reopen") : t("a11y.task.complete"),
        })}
        onPress={onToggle}
        hitSlop={8}
        style={styles.checkboxHit}
      >
        <View
          style={[
            styles.checkbox,
            {
              borderColor: completed ? colors.primary : colors.borderStrong,
              backgroundColor: completed ? colors.primary : "transparent",
            },
          ]}
        >
          {completed ? <Ionicons name="checkmark" size={15} color={colors.onPrimary} /> : null}
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("tasks.editA11y", { title: task.title })}
        onPress={onOpen}
        style={styles.rowBody}
      >
        <StoneText
          variant="body"
          tone={completed ? "muted" : "default"}
          numberOfLines={2}
          style={completed ? styles.completedTitle : undefined}
        >
          {task.title}
        </StoneText>
        <View style={styles.taskMeta}>
          {task.priority !== "none" ? (
            <Badge
              label={formatTaskPriority(locale, task.priority)}
              tone={priorityTone[task.priority]}
            />
          ) : null}
          <StoneText variant="caption" tone="muted">
            {task.dueDate ?? t("tasks.noDate")}
            {task.dueTime ? ` ${task.dueTime}` : ""}
          </StoneText>
          {task.sourceDocumentId ? (
            <Ionicons name="link-outline" size={13} color={colors.textMuted} />
          ) : null}
        </View>
      </Pressable>
      <IconButton
        icon="chevron-forward"
        tone="muted"
        accessibilityLabel={t("tasks.editA11y", { title: task.title })}
        onPress={onOpen}
      />
    </View>
  );
}

function message(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.giant },
  section: { gap: spacing.sm, marginTop: spacing.xl },
  filters: { gap: spacing.sm, paddingVertical: spacing.lg, paddingRight: spacing.lg },

  capture: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: 54,
    borderWidth: hairline,
    borderRadius: radii.lg,
    paddingLeft: spacing.lg,
    paddingRight: spacing.xs,
    marginBottom: spacing.md,
  },
  captureInput: { flex: 1, paddingVertical: spacing.md, ...typography.body },
  captureAction: {
    width: 36,
    height: 36,
    borderRadius: radii.pill,
    alignItems: "center",
    justifyContent: "center",
  },

  timeline: { overflow: "hidden" },
  rowDivider: { height: hairline, marginLeft: spacing.giant + spacing.sm },

  agendaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  agendaIcon: {
    width: 32,
    height: 32,
    borderRadius: radii.sm,
    alignItems: "center",
    justifyContent: "center",
  },

  taskRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingLeft: spacing.lg,
    paddingRight: spacing.xs,
    paddingVertical: spacing.sm,
  },
  checkboxHit: {
    width: 32,
    height: touchTarget,
    alignItems: "center",
    justifyContent: "center",
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: radii.xs,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  rowBody: { flex: 1, gap: spacing.xxs, paddingVertical: spacing.xs },
  completedTitle: { textDecorationLine: "line-through" },
  taskMeta: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.xs },

  signalHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  signalMeta: { marginTop: spacing.xs },
});
