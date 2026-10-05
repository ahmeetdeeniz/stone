import * as Crypto from "expo-crypto";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import {
  buildAgendaItems,
  parseQuickAdd,
  type AgendaItem,
  type QuickAddResult,
  type Task,
  type TaskListOptions,
  type TodayItem,
} from "@stone/domain";
import { formatTaskPriority } from "@stone/i18n";
import { ResponsiveContent } from "../../src/components/responsive";
import { EmptyState, ErrorState, LoadingState } from "../../src/components/states";
import {
  IconButton,
  ListGroup,
  ListRow,
  Overline,
  Screen,
  ScreenHeader,
  SegmentedControl,
  StoneText,
  numeric,
} from "../../src/components/ui";
import { hairline, radii, spacing, typography, touchTarget } from "../../src/design/tokens";
import { useTheme } from "../../src/design/theme";
import { useAuth } from "../../src/providers/auth-provider";
import { useAppServices } from "../../src/providers/app-provider";
import { useI18n } from "../../src/i18n/provider";

type ViewFilter = "today" | "upcoming" | "all" | "completed";

export default function TodayScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { taskUseCases, projectUseCases, calendar, deviceId } = useAppServices();
  const { locale, t } = useI18n();
  const filterOptions: readonly { value: ViewFilter; label: string }[] = [
    { value: "today", label: t("tasks.today") },
    { value: "upcoming", label: t("tasks.upcoming") },
    { value: "all", label: t("common.all") },
    { value: "completed", label: t("tasks.completedShort") },
  ];
  const [tasks, setTasks] = useState<readonly Task[]>([]);
  const [overdue, setOverdue] = useState<readonly Task[]>([]);
  const [signals, setSignals] = useState<readonly TodayItem[]>([]);
  const [agendaItems, setAgendaItems] = useState<readonly AgendaItem[]>([]);
  const [capture, setCapture] = useState("");
  const [filter, setFilter] = useState<ViewFilter>("today");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // The user's calendar day, not UTC's (which is "yesterday" for hours after midnight east of UTC).
  const today = localToday();
  const parsedCapture = useMemo(
    () => (capture.trim() ? parseQuickAdd(capture, { today }) : null),
    [capture, today],
  );
  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      setError(null);
      const options: TaskListOptions =
        filter === "completed"
          ? { state: "completed" }
          : filter === "all"
            ? { state: "open" }
            : { state: "open", due: filter, today };
      const [nextTasks, nextOverdue, nextSignals, nextCalendar] = await Promise.all([
        taskUseCases.list(user.uid, options),
        // Overdue work belongs on today's list instead of behind its own filter.
        filter === "today"
          ? taskUseCases.list(user.uid, { state: "open", due: "overdue", today })
          : Promise.resolve([] as readonly Task[]),
        projectUseCases.today(user.uid, new Date().toISOString()),
        calendar.list(user.uid, { startDate: today, endDate: today }),
      ]);
      setTasks(nextTasks);
      setOverdue(nextOverdue);
      setSignals(nextSignals.filter((item) => item.kind !== "task"));
      setAgendaItems(buildAgendaItems(nextCalendar, [], [], today, today));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("tasks.loadPlanningFailed"));
    } finally {
      setLoading(false);
    }
  }, [calendar, filter, projectUseCases, taskUseCases, today, user]);

  useFocusEffect(useCallback(() => void load(), [load]));

  const quickAdd = async () => {
    if (!user || !capture.trim()) return;
    const now = new Date().toISOString();
    const parsed = parseQuickAdd(capture, { today });
    try {
      const projectId = parsed.projectHint
        ? matchProject(await projectUseCases.list(user.uid), parsed.projectHint)
        : null;
      await taskUseCases.create({
        schemaVersion: 1,
        id: Crypto.randomUUID(),
        ownerId: user.uid,
        title: parsed.title,
        description: null,
        state: "open",
        completedAt: null,
        dueDate: parsed.dueDate ?? (filter === "today" ? today : null),
        dueTime: parsed.dueTime,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        priority: parsed.priority,
        sortOrder: Date.now(),
        tags: [...parsed.tags],
        projectId,
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

  const dateLabel = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long" }).format(
        new Date(),
      ),
    [locale],
  );
  const openTask = (task: Task) => router.push({ pathname: "/task/[id]", params: { id: task.id } });
  const taskList = (items: readonly Task[]) => (
    <ListGroup>
      {items.map((task) => (
        <TaskRow
          key={task.id}
          task={task}
          today={today}
          onToggle={() => void toggle(task)}
          onOpen={() => openTask(task)}
        />
      ))}
    </ListGroup>
  );

  return (
    <Screen padded={false}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.page}
      >
        <ResponsiveContent>
          <ScreenHeader
            title={t("tabs.today")}
            subtitle={dateLabel}
            actions={
              <>
                <IconButton
                  icon="search"
                  accessibilityLabel={t("search.title")}
                  onPress={() => router.push("/search")}
                />
                <IconButton
                  icon="stats-chart-outline"
                  accessibilityLabel={t("review.title")}
                  onPress={() => router.push("/review")}
                />
                <IconButton
                  icon="settings-outline"
                  accessibilityLabel={t("tabs.settings")}
                  onPress={() => router.push("/settings")}
                />
              </>
            }
          />

          <QuickCapture
            value={capture}
            onChangeText={setCapture}
            onSubmit={() => void quickAdd()}
            placeholder={t("tasks.quickAddPlaceholder")}
            accessibilityLabel={t("tasks.quickAdd")}
            addLabel={t("tasks.add")}
          />
          {parsedCapture ? <QuickAddPreview parsed={parsedCapture} today={today} /> : null}

          <View style={styles.filters}>
            <SegmentedControl
              options={filterOptions}
              value={filter}
              onChange={setFilter}
              accessibilityLabel={t("tasks.filtersA11y")}
            />
          </View>

          {loading && tasks.length === 0 ? (
            <LoadingState label={t("tasks.loading")} />
          ) : error ? (
            <ErrorState message={error} onRetry={() => void load()} />
          ) : (
            <>
              {filter === "today" && agendaItems.length > 0 ? (
                <View style={styles.section}>
                  <Overline>{t("tabs.calendar")}</Overline>
                  <ListGroup>
                    {agendaItems.map((item) => (
                      <AgendaRow key={item.id} item={item} />
                    ))}
                  </ListGroup>
                </View>
              ) : null}

              {overdue.length > 0 ? (
                <View style={styles.section}>
                  <Overline tone="danger">{t("tasks.overdue")}</Overline>
                  {taskList(overdue)}
                </View>
              ) : null}

              <View style={styles.section}>
                {filter === "today" && (overdue.length > 0 || agendaItems.length > 0) ? (
                  <Overline>{t("tasks.title")}</Overline>
                ) : null}
                {tasks.length === 0 ? (
                  <EmptyState
                    icon="checkmark-done-outline"
                    title={t("tasks.emptyFilter")}
                    description={t("tasks.emptyFilterDetail")}
                  />
                ) : (
                  taskList(tasks)
                )}
              </View>

              {filter === "today" && signals.length > 0 ? (
                <View style={styles.section}>
                  <Overline>{t("tasks.projectSignals")}</Overline>
                  <ListGroup>
                    {signals.map((item) => (
                      <ListRow
                        key={item.id}
                        title={item.text}
                        subtitle={item.projectTitle}
                        meta={item.blocked ? t("tasks.blocker") : null}
                        chevron
                        accessibilityLabel={t("tasks.openProjectA11y", {
                          title: item.projectTitle,
                        })}
                        onPress={() =>
                          router.push({
                            pathname: "/project/[id]",
                            params: { id: item.projectId },
                          })
                        }
                      />
                    ))}
                  </ListGroup>
                </View>
              ) : null}
            </>
          )}
        </ResponsiveContent>
      </ScrollView>
    </Screen>
  );
}

function localToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Resolves `@hint` to a project by slug or title prefix, case-insensitively. */
function matchProject(
  projects: readonly { id: string; title: string; slug: string }[],
  hint: string,
): string | null {
  const needle = hint.toLocaleLowerCase("tr");
  const match =
    projects.find((project) => project.slug.toLocaleLowerCase("tr") === needle) ??
    projects.find((project) => project.title.toLocaleLowerCase("tr").startsWith(needle)) ??
    projects.find((project) => project.slug.toLocaleLowerCase("tr").startsWith(needle));
  return match?.id ?? null;
}

/** Shows what the capture line will become before it is submitted. */
function QuickAddPreview({ parsed, today }: { parsed: QuickAddResult; today: string }) {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const parts: string[] = [];
  if (parsed.dueDate) {
    const label =
      parsed.dueDate === today
        ? t("tasks.today")
        : new Intl.DateTimeFormat(locale, {
            day: "numeric",
            month: "short",
            weekday: "short",
          }).format(new Date(`${parsed.dueDate}T12:00:00`));
    parts.push(parsed.dueTime ? `${label} ${parsed.dueTime}` : label);
  }
  if (parsed.priority !== "none") parts.push(formatTaskPriority(locale, parsed.priority));
  for (const tag of parsed.tags) parts.push(`#${tag}`);
  if (parsed.projectHint) parts.push(`@${parsed.projectHint}`);
  if (parts.length === 0) return null;
  return (
    <View style={styles.preview} accessibilityLiveRegion="polite">
      <Ionicons name="sparkles-outline" size={14} color={colors.primaryText} />
      <StoneText variant="bodySmall" tone="secondary" numberOfLines={1} style={styles.previewText}>
        {`${parsed.title} · ${parts.join(" · ")}`}
      </StoneText>
    </View>
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

function AgendaRow({ item }: { item: AgendaItem }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  return (
    <View style={styles.agendaRow}>
      <StoneText variant="label" tone="secondary" style={[styles.agendaTime, numeric]}>
        {item.sortTime ?? t("calendar.allDay")}
      </StoneText>
      <View style={[styles.agendaBar, { backgroundColor: colors.primary }]} />
      <View style={styles.agendaBody}>
        <StoneText variant="body" numberOfLines={1}>
          {item.title}
        </StoneText>
        <StoneText variant="caption" tone="muted">
          {agendaLabel(item.kind, t)}
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

function TaskRow({
  task,
  today,
  onToggle,
  onOpen,
}: {
  task: Task;
  today: string;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const completed = task.state === "completed";
  const { colors, tones } = useTheme();
  const { locale, t } = useI18n();
  const due =
    task.dueDate && task.dueDate !== today
      ? new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(
          new Date(`${task.dueDate}T12:00:00`),
        )
      : null;
  const meta = [due, task.dueTime].filter(Boolean).join(" ");
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
              borderColor: completed
                ? colors.primary
                : task.priority === "high"
                  ? tones.danger.fg
                  : colors.borderStrong,
              backgroundColor: completed ? colors.primary : "transparent",
            },
          ]}
        >
          {completed ? <Ionicons name="checkmark" size={14} color={colors.onPrimary} /> : null}
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("tasks.editA11y", { title: task.title })}
        onPress={onOpen}
        style={({ pressed }) => [styles.rowBody, pressed && { opacity: 0.6 }]}
      >
        <StoneText
          variant="body"
          tone={completed ? "muted" : "default"}
          numberOfLines={2}
          style={completed ? styles.completedTitle : undefined}
        >
          {task.title}
        </StoneText>
        {task.priority !== "none" || meta || task.tags.length > 0 || task.sourceDocumentId ? (
          <View style={styles.taskMeta}>
            {task.priority !== "none" ? (
              <StoneText
                variant="caption"
                style={{ color: task.priority === "high" ? tones.danger.fg : colors.textMuted }}
              >
                {formatTaskPriority(locale, task.priority)}
              </StoneText>
            ) : null}
            {meta ? (
              <StoneText variant="caption" tone="muted" style={numeric}>
                {meta}
              </StoneText>
            ) : null}
            {task.tags.slice(0, 3).map((tag) => (
              <StoneText key={tag} variant="caption" tone="muted">
                #{tag}
              </StoneText>
            ))}
            {task.sourceDocumentId ? (
              <Ionicons name="link-outline" size={12} color={colors.textMuted} />
            ) : null}
          </View>
        ) : null}
      </Pressable>
    </View>
  );
}

function message(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.giant },
  section: { gap: spacing.sm, marginTop: spacing.xl },
  filters: { marginTop: spacing.xs },

  capture: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: 52,
    borderWidth: hairline,
    borderRadius: radii.lg,
    paddingLeft: spacing.lg,
    paddingRight: spacing.xs,
    marginBottom: spacing.md,
  },
  captureInput: { flex: 1, paddingVertical: spacing.md, ...typography.body },
  preview: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginTop: -spacing.xs,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  previewText: { flex: 1 },
  captureAction: {
    width: 36,
    height: 36,
    borderRadius: radii.pill,
    alignItems: "center",
    justifyContent: "center",
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

  taskRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingLeft: spacing.md,
    paddingRight: spacing.lg,
    minHeight: 52,
  },
  checkboxHit: {
    width: 36,
    height: touchTarget,
    alignItems: "center",
    justifyContent: "center",
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  rowBody: { flex: 1, gap: 2, paddingVertical: spacing.md },
  completedTitle: { textDecorationLine: "line-through" },
  taskMeta: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.sm },
});
