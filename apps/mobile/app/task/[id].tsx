import * as Crypto from "expo-crypto";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, View } from "react-native";
import {
  zonedWallTimeToInstant,
  type Project,
  type Task,
  type TaskRecurrenceFrequency,
} from "@stone/domain";
import { formatTaskPriority, type TranslationKey } from "@stone/i18n";
import { ResponsiveContent } from "../../src/components/responsive";
import { ErrorState, LoadingState } from "../../src/components/states";
import { Screen, StoneButton, StoneInput, StoneText, Surface } from "../../src/components/ui";
import { spacing } from "../../src/design/tokens";
import { useAuth } from "../../src/providers/auth-provider";
import { useAppServices } from "../../src/providers/app-provider";
import { useI18n } from "../../src/i18n/provider";

const RECURRENCES: readonly (TaskRecurrenceFrequency | "none")[] = [
  "none",
  "daily",
  "weekdays",
  "weekly",
  "monthly",
];

export default function TaskDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const { taskUseCases, projectUseCases, calendar, deviceId } = useAppServices();
  const { locale, t } = useI18n();
  const [task, setTask] = useState<Task | null>(null);
  const [subtasks, setSubtasks] = useState<readonly Task[]>([]);
  const [projects, setProjects] = useState<readonly Project[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("");
  const [tags, setTags] = useState("");
  const [estimate, setEstimate] = useState("");
  const [subtaskTitle, setSubtaskTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    if (!user || !id) return;
    try {
      setError(null);
      const current = await taskUseCases.get(user.uid, id);
      if (!current) throw new Error(t("tasks.notFound"));
      const [children, projectList] = await Promise.all([
        taskUseCases.list(user.uid, { parentTaskId: current.id }),
        projectUseCases.list(user.uid),
      ]);
      setTask(current);
      setSubtasks(children);
      setProjects(projectList);
      setTitle(current.title);
      setDescription(current.description ?? "");
      setDueDate(current.dueDate ?? "");
      setDueTime(current.dueTime ?? "");
      setTags(current.tags.join(", "));
      setEstimate(current.estimatedMinutes?.toString() ?? "");
    } catch (caught) {
      setError(message(caught, t("app.unknownError")));
    }
  };

  useEffect(() => void load(), [id, user]);

  const save = async () => {
    if (!user || !task) return;
    setSaving(true);
    try {
      const updated = await taskUseCases.update(
        user.uid,
        {
          ...task,
          title,
          description: description.trim() || null,
          dueDate: dueDate.trim() || null,
          dueTime: dueTime.trim() || null,
          tags: tags
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean),
          estimatedMinutes: estimate.trim() ? Number(estimate) : null,
        },
        task.revision,
        deviceId,
      );
      setTask(updated);
      Alert.alert(t("tasks.saved"), t("tasks.savedLocally"));
    } catch (caught) {
      Alert.alert(t("tasks.saveFailed"), message(caught, t("app.unknownError")));
    } finally {
      setSaving(false);
    }
  };

  const setPriority = async (priority: Task["priority"]) => {
    if (!user || !task) return;
    try {
      const updated = await taskUseCases.update(
        user.uid,
        { ...task, priority },
        task.revision,
        deviceId,
      );
      setTask(updated);
    } catch (caught) {
      Alert.alert(t("tasks.priorityFailed"), message(caught, t("app.unknownError")));
    }
  };

  const setProject = async (projectId: string | null) => {
    if (!user || !task) return;
    try {
      const updated = await taskUseCases.update(
        user.uid,
        { ...task, projectId },
        task.revision,
        deviceId,
      );
      setTask(updated);
    } catch (caught) {
      Alert.alert(t("tasks.projectFailed"), message(caught, t("app.unknownError")));
    }
  };

  const setRecurrence = async (frequency: TaskRecurrenceFrequency | "none") => {
    if (!user || !task) return;
    try {
      const updated = await taskUseCases.update(
        user.uid,
        {
          ...task,
          recurrence:
            frequency === "none"
              ? null
              : {
                  frequency,
                  interval: 1,
                  unit: frequency === "weekly" ? "week" : frequency === "monthly" ? "month" : "day",
                  preferredDayOfMonth:
                    frequency === "monthly" && task.dueDate ? Number(task.dueDate.slice(-2)) : null,
                },
          recurrenceSeriesId: frequency === "none" ? null : (task.recurrenceSeriesId ?? task.id),
          occurrenceDate: frequency === "none" ? null : task.dueDate,
        },
        task.revision,
        deviceId,
      );
      setTask(updated);
    } catch (caught) {
      Alert.alert(t("tasks.recurrenceFailed"), message(caught, t("app.unknownError")));
    }
  };

  const addSubtask = async () => {
    if (!user || !task || !subtaskTitle.trim()) return;
    const now = new Date().toISOString();
    try {
      await taskUseCases.create({
        ...task,
        id: Crypto.randomUUID(),
        title: subtaskTitle.trim(),
        description: null,
        state: "open",
        completedAt: null,
        parentTaskId: task.id,
        sourceDocumentId: null,
        sourceBlockId: null,
        recurrence: null,
        recurrenceSeriesId: null,
        occurrenceDate: null,
        sortOrder: subtasks.length,
        revision: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        updatedByDeviceId: deviceId,
      });
      setSubtaskTitle("");
      await load();
    } catch (caught) {
      Alert.alert(t("tasks.subtaskAddFailed"), message(caught, t("app.unknownError")));
    }
  };

  const move = async (index: number, direction: -1 | 1) => {
    if (!user || !task) return;
    const target = index + direction;
    if (target < 0 || target >= subtasks.length) return;
    const ordered = [...subtasks];
    [ordered[index], ordered[target]] = [ordered[target]!, ordered[index]!];
    try {
      setSubtasks(
        await taskUseCases.reorder(
          user.uid,
          task.id,
          ordered.map((item) => item.id),
          deviceId,
        ),
      );
    } catch (caught) {
      Alert.alert(t("tasks.reorderFailed"), message(caught, t("app.unknownError")));
    }
  };

  const remove = (subtask: Task) =>
    Alert.alert(t("tasks.deleteSubtask"), subtask.title, [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.delete"),
        style: "destructive",
        onPress: () =>
          void (async () => {
            if (!user) return;
            await taskUseCases.delete(user.uid, subtask.id, deviceId);
            await load();
          })(),
      },
    ]);

  const deleteTask = () =>
    Alert.alert(t("tasks.deleteTask"), t("tasks.deleteDetail"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.delete"),
        style: "destructive",
        onPress: () =>
          void (async () => {
            if (!user || !task) return;
            await taskUseCases.delete(user.uid, task.id, deviceId);
            router.back();
          })(),
      },
    ]);

  const scheduleTask = async () => {
    if (!user || !task) return;
    const date = task.dueDate ?? new Date().toISOString().slice(0, 10);
    const startTime = task.dueTime ?? "09:00";
    const startMinutes = Number(startTime.slice(0, 2)) * 60 + Number(startTime.slice(3));
    const endMinutes = Math.min(startMinutes + (task.estimatedMinutes ?? 60), 23 * 60 + 59);
    const endTime = `${String(Math.floor(endMinutes / 60)).padStart(2, "0")}:${String(endMinutes % 60).padStart(2, "0")}`;
    const now = new Date().toISOString();
    try {
      const block = await calendar.create({
        schemaVersion: 1,
        id: Crypto.randomUUID(),
        ownerId: user.uid,
        revision: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        updatedByDeviceId: deviceId,
        kind: "task_block",
        title: task.title,
        description: task.description,
        allDay: false,
        startDate: date,
        endDate: date,
        startAt: zonedWallTimeToInstant(date, startTime, task.timezone, "earlier"),
        endAt: zonedWallTimeToInstant(date, endTime, task.timezone, "later"),
        timezone: task.timezone,
        location: null,
        category: "blue",
        projectId: task.projectId,
        sourceDocumentId: task.sourceDocumentId,
        taskId: task.id,
        planningNote: null,
        recurrence: null,
        recurrenceSeriesId: null,
        recurrenceId: null,
        overrides: [],
        externalUid: null,
        cancelledAt: null,
      });
      router.push({ pathname: "/calendar/[id]" as never, params: { id: block.id } });
    } catch (caught) {
      Alert.alert(t("tasks.scheduleFailed"), message(caught, t("app.unknownError")));
    }
  };

  const recurrence = useMemo(() => task?.recurrence?.frequency ?? "none", [task]);

  if (error)
    return (
      <Screen>
        <ErrorState message={error} onRetry={() => void load()} />
      </Screen>
    );
  if (!task)
    return (
      <Screen>
        <LoadingState label={t("tasks.loadingTask")} />
      </Screen>
    );

  return (
    <Screen padded={false}>
      <Stack.Screen options={{ title: t("tabs.tasks"), headerBackTitle: t("planning.title") }} />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.page}>
        <ResponsiveContent>
          <StoneInput label={t("tasks.titleField")} value={title} onChangeText={setTitle} />
          <StoneInput
            label={t("tasks.description")}
            value={description}
            onChangeText={setDescription}
            multiline
          />
          <View style={styles.twoColumns}>
            <StoneInput
              label={t("tasks.dateField")}
              value={dueDate}
              onChangeText={setDueDate}
              placeholder="2026-08-01"
              containerStyle={styles.field}
            />
            <StoneInput
              label={t("tasks.timeField")}
              value={dueTime}
              onChangeText={setDueTime}
              placeholder="09:00"
              containerStyle={styles.field}
            />
          </View>
          <StoneText variant="caption">{t("tasks.timeNoNotification")}</StoneText>
          <StoneInput label={t("tasks.tagsField")} value={tags} onChangeText={setTags} />
          <StoneInput
            label={t("tasks.estimateField")}
            value={estimate}
            onChangeText={setEstimate}
            keyboardType="number-pad"
          />
          <ChoiceSection
            title={t("tasks.priority")}
            values={["none", "low", "medium", "high"]}
            selected={task.priority}
            labelFor={(value) => formatTaskPriority(locale, value)}
            onSelect={(value) => void setPriority(value)}
          />
          <ChoiceSection
            title={t("tasks.recurrence")}
            values={RECURRENCES}
            selected={recurrence}
            labelFor={(value) => t(`recurrence.${value}` as TranslationKey)}
            onSelect={(value) => void setRecurrence(value)}
          />
          <StoneText variant="label">{t("tasks.project")}</StoneText>
          <ScrollView horizontal contentContainerStyle={styles.choices}>
            <Choice
              label={t("tasks.noProject")}
              selected={!task.projectId}
              onPress={() => void setProject(null)}
            />
            {projects.map((project) => (
              <Choice
                key={project.id}
                label={project.title}
                selected={task.projectId === project.id}
                onPress={() => void setProject(project.id)}
              />
            ))}
          </ScrollView>
          {task.sourceDocumentId ? (
            <Surface>
              <StoneText variant="label">{t("tasks.markdownLinked")}</StoneText>
              <StoneText variant="bodySmall">{t("tasks.markdownLinkedDetail")}</StoneText>
              <StoneButton
                label={t("tasks.openSourceNote")}
                variant="secondary"
                onPress={() =>
                  router.push({
                    pathname: "/editor",
                    params: { id: task.sourceDocumentId! },
                  })
                }
              />
            </Surface>
          ) : null}
          <StoneButton
            label={saving ? t("tasks.saving") : t("tasks.saveChanges")}
            onPress={() => void save()}
            disabled={saving || !title.trim()}
          />
          <StoneButton
            label={t("tasks.schedule")}
            variant="secondary"
            onPress={() => void scheduleTask()}
          />
          <StoneButton
            label={t("focus.startLinked")}
            variant="secondary"
            onPress={() =>
              router.push({
                pathname: "/(tabs)/focus" as never,
                params: { taskId: task.id, projectId: task.projectId ?? undefined },
              })
            }
          />
          <StoneText variant="caption">{t("tasks.blockDistinct")}</StoneText>
          <View style={styles.subtasks}>
            <StoneText variant="title3">{t("tasks.subtasks")}</StoneText>
            <View style={styles.addSubtask}>
              <StoneInput
                label={t("tasks.newSubtask")}
                value={subtaskTitle}
                onChangeText={setSubtaskTitle}
                containerStyle={styles.field}
                onSubmitEditing={() => void addSubtask()}
              />
              <StoneButton
                label={t("common.create")}
                variant="secondary"
                onPress={() => void addSubtask()}
                disabled={!subtaskTitle.trim()}
              />
            </View>
            {subtasks.map((subtask, index) => (
              <Surface key={subtask.id}>
                <StoneText>{subtask.title}</StoneText>
                <View style={styles.rowActions}>
                  <StoneButton
                    label={t("tasks.moveUp")}
                    variant="quiet"
                    onPress={() => void move(index, -1)}
                    disabled={index === 0}
                  />
                  <StoneButton
                    label={t("tasks.moveDown")}
                    variant="quiet"
                    onPress={() => void move(index, 1)}
                    disabled={index === subtasks.length - 1}
                  />
                  <StoneButton
                    label={t("common.delete")}
                    variant="quiet"
                    onPress={() => remove(subtask)}
                  />
                </View>
              </Surface>
            ))}
          </View>
          <StoneButton label={t("tasks.deleteTask")} variant="quiet" onPress={deleteTask} />
        </ResponsiveContent>
      </ScrollView>
    </Screen>
  );
}

function ChoiceSection<Value extends string>({
  title,
  values,
  selected,
  onSelect,
  labelFor = (value) => value,
}: {
  title: string;
  values: readonly Value[];
  selected: Value;
  onSelect: (value: Value) => void;
  labelFor?: (value: Value) => string;
}) {
  return (
    <View style={styles.choiceSection}>
      <StoneText variant="label">{title}</StoneText>
      <ScrollView horizontal contentContainerStyle={styles.choices}>
        {values.map((value) => (
          <Choice
            key={value}
            label={labelFor(value)}
            selected={selected === value}
            onPress={() => onSelect(value)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

function Choice({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.choice, selected && styles.choiceSelected]}
    >
      <StoneText variant="label">{label}</StoneText>
    </Pressable>
  );
}

function message(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: spacing.lg, paddingVertical: spacing.xl },
  twoColumns: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  field: { flex: 1, minWidth: 180 },
  choiceSection: { gap: spacing.sm },
  choices: { gap: spacing.sm, paddingVertical: spacing.sm },
  choice: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    borderWidth: 1,
    borderColor: "#D4CEE3",
    borderRadius: 999,
  },
  choiceSelected: { backgroundColor: "#E8E5FF", borderColor: "#8075F0" },
  subtasks: { gap: spacing.md, marginTop: spacing.xxl },
  addSubtask: { gap: spacing.sm },
  rowActions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
});
