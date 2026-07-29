import * as Crypto from "expo-crypto";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, View } from "react-native";
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
import { Screen, StoneButton, StoneInput, StoneText, Surface } from "../../src/components/ui";
import { spacing } from "../../src/design/tokens";
import { useAuth } from "../../src/providers/auth-provider";
import { useAppServices } from "../../src/providers/app-provider";
import { useI18n } from "../../src/i18n/provider";

type ViewFilter = "all" | "today" | "upcoming" | "overdue" | "completed";

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
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.page}>
        <ResponsiveContent>
          <StoneText variant="title1">{t("planning.title")}</StoneText>
          <StoneText variant="bodySmall" style={styles.subtitle}>
            {subtitle}
          </StoneText>
          <View style={styles.quickAdd}>
            <StoneInput
              label={t("tasks.quickAdd")}
              value={capture}
              onChangeText={setCapture}
              placeholder={t("tasks.quickAddPlaceholder")}
              returnKeyType="done"
              onSubmitEditing={() => void quickAdd()}
            />
            <StoneButton
              label={t("tasks.add")}
              onPress={() => void quickAdd()}
              disabled={!capture.trim()}
            />
          </View>
          <StoneInput
            label={t("tasks.search")}
            value={search}
            onChangeText={setSearch}
            placeholder={t("tasks.searchPlaceholder")}
            returnKeyType="search"
          />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filters}
          >
            {(Object.keys(filterLabels) as ViewFilter[]).map((value) => (
              <Pressable
                key={value}
                accessibilityRole="button"
                accessibilityState={{ selected: filter === value }}
                accessibilityLabel={t("tasks.showFilter", { filter: filterLabels[value] })}
                onPress={() => setFilter(value)}
                style={[styles.filter, filter === value && styles.filterActive]}
              >
                <StoneText variant="label">{filterLabels[value]}</StoneText>
              </Pressable>
            ))}
          </ScrollView>
          {filter === "today" && agendaItems.length > 0 ? (
            <View style={styles.signals}>
              <StoneText variant="title3">{t("tasks.timelineToday")}</StoneText>
              {agendaItems.map((item) => (
                <Surface key={item.id}>
                  <StoneText variant="caption">{agendaLabel(item.kind, t)}</StoneText>
                  <StoneText>{item.title}</StoneText>
                  <StoneText variant="caption">
                    {item.sortTime ?? t("calendar.allDay")}
                    {item.completed ? ` · ${t("tasks.completed")}` : ""}
                  </StoneText>
                </Surface>
              ))}
            </View>
          ) : null}
          {loading ? (
            <LoadingState label={t("tasks.loading")} />
          ) : error ? (
            <ErrorState message={error} onRetry={() => void load()} />
          ) : tasks.length === 0 ? (
            <EmptyState title={t("tasks.emptyFilter")} description={t("tasks.emptyFilterDetail")} />
          ) : (
            <View style={styles.list}>
              {tasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  onToggle={() => void toggle(task)}
                  onOpen={() => router.push({ pathname: "/task/[id]", params: { id: task.id } })}
                />
              ))}
            </View>
          )}
          {filter === "today" && signals.length > 0 ? (
            <View style={styles.signals}>
              <StoneText variant="title3">{t("tasks.projectSignals")}</StoneText>
              {signals.map((item) => (
                <Surface key={item.id}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t("tasks.openProjectA11y", { title: item.projectTitle })}
                    onPress={() =>
                      router.push({ pathname: "/project/[id]", params: { id: item.projectId } })
                    }
                  >
                    <StoneText variant="caption">{item.projectTitle}</StoneText>
                    <StoneText>{item.text}</StoneText>
                    <StoneText variant="caption">
                      {item.blocked ? `${t("tasks.blocker")} · ` : ""}
                      {item.dueDate ?? t("tasks.noDate")}
                    </StoneText>
                  </Pressable>
                </Surface>
              ))}
            </View>
          ) : null}
        </ResponsiveContent>
      </ScrollView>
    </Screen>
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
  onToggle,
  onOpen,
}: {
  task: Task;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const completed = task.state === "completed";
  const { locale, t } = useI18n();
  return (
    <Surface>
      <View style={styles.taskRow}>
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: completed }}
          accessibilityLabel={t("tasks.toggleA11y", {
            title: task.title,
            action: completed ? t("a11y.task.reopen") : t("a11y.task.complete"),
          })}
          onPress={onToggle}
          style={[styles.checkbox, completed && styles.checkboxChecked]}
        >
          <StoneText variant="label">{completed ? "✓" : ""}</StoneText>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("tasks.editA11y", { title: task.title })}
          onPress={onOpen}
          style={styles.taskBody}
        >
          <StoneText variant="body">{task.title}</StoneText>
          <StoneText variant="caption">
            {task.priority !== "none" ? `${formatTaskPriority(locale, task.priority)} · ` : ""}
            {task.dueDate ?? t("tasks.noDate")}
            {task.dueTime ? ` ${task.dueTime}` : ""}
            {task.sourceDocumentId ? ` · ${t("tasks.linkedMarkdown")}` : ""}
          </StoneText>
          {completed ? <StoneText variant="caption">{t("tasks.completed")}</StoneText> : null}
        </Pressable>
      </View>
    </Surface>
  );
}

function message(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: spacing.lg, paddingTop: spacing.xl, paddingBottom: spacing.giant },
  subtitle: { marginTop: spacing.xs, marginBottom: spacing.lg },
  quickAdd: { gap: spacing.sm, marginBottom: spacing.lg },
  filters: { gap: spacing.sm, paddingVertical: spacing.lg },
  filter: {
    minHeight: 44,
    minWidth: 72,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#D4CEE3",
  },
  filterActive: { backgroundColor: "#E8E5FF", borderColor: "#8075F0" },
  list: { gap: spacing.md },
  taskRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  checkbox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "#8075F0",
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxChecked: { backgroundColor: "#E8E5FF" },
  taskBody: { flex: 1, minHeight: 44, justifyContent: "center", gap: spacing.xs },
  signals: { gap: spacing.md, marginTop: spacing.xxl },
});
