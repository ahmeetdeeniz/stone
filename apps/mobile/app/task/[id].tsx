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
import { ResponsiveContent } from "../../src/components/responsive";
import { ErrorState, LoadingState } from "../../src/components/states";
import { Screen, StoneButton, StoneInput, StoneText, Surface } from "../../src/components/ui";
import { spacing } from "../../src/design/tokens";
import { useAuth } from "../../src/providers/auth-provider";
import { useAppServices } from "../../src/providers/app-provider";

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
      if (!current) throw new Error("Görev bulunamadı.");
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
      setError(message(caught));
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
      Alert.alert("Kaydedildi", "Görev önce yerel olarak kaydedildi.");
    } catch (caught) {
      Alert.alert("Görev kaydedilemedi", message(caught));
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
      Alert.alert("Öncelik değiştirilemedi", message(caught));
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
      Alert.alert("Proje değiştirilemedi", message(caught));
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
      Alert.alert("Tekrar ayarı değiştirilemedi", message(caught));
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
      Alert.alert("Alt görev eklenemedi", message(caught));
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
      Alert.alert("Sıralama değiştirilemedi", message(caught));
    }
  };

  const remove = (subtask: Task) =>
    Alert.alert("Alt görevi sil", subtask.title, [
      { text: "Vazgeç", style: "cancel" },
      {
        text: "Sil",
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
    Alert.alert("Görevi sil", "Görev çöp durumuna alınacak ve eşitlenecek.", [
      { text: "Vazgeç", style: "cancel" },
      {
        text: "Sil",
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
      Alert.alert("Görev planlanamadı", message(caught));
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
        <LoadingState label="Görev yükleniyor" />
      </Screen>
    );

  return (
    <Screen padded={false}>
      <Stack.Screen options={{ title: "Görev", headerBackTitle: "Planlama" }} />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.page}>
        <ResponsiveContent>
          <StoneInput label="Başlık" value={title} onChangeText={setTitle} />
          <StoneInput
            label="Açıklama"
            value={description}
            onChangeText={setDescription}
            multiline
          />
          <View style={styles.twoColumns}>
            <StoneInput
              label="Tarih (YYYY-AA-GG)"
              value={dueDate}
              onChangeText={setDueDate}
              placeholder="2026-08-01"
              containerStyle={styles.field}
            />
            <StoneInput
              label="Saat (SS:dd)"
              value={dueTime}
              onChangeText={setDueTime}
              placeholder="09:00"
              containerStyle={styles.field}
            />
          </View>
          <StoneText variant="caption">
            Saat işletim sistemi bildirimi planlamaz; yalnızca planlama bilgisidir.
          </StoneText>
          <StoneInput label="Etiketler (virgülle)" value={tags} onChangeText={setTags} />
          <StoneInput
            label="Tahmini süre (dakika)"
            value={estimate}
            onChangeText={setEstimate}
            keyboardType="number-pad"
          />
          <ChoiceSection
            title="Öncelik"
            values={["none", "low", "medium", "high"]}
            selected={task.priority}
            onSelect={(value) => void setPriority(value as Task["priority"])}
          />
          <ChoiceSection
            title="Tekrar"
            values={RECURRENCES}
            selected={recurrence}
            onSelect={(value) => void setRecurrence(value as TaskRecurrenceFrequency | "none")}
          />
          <StoneText variant="label">Proje</StoneText>
          <ScrollView horizontal contentContainerStyle={styles.choices}>
            <Choice
              label="Projesiz"
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
              <StoneText variant="label">Markdown bağlantılı görev</StoneText>
              <StoneText variant="bodySmall">
                Tamamlama durumu kaynak nottaki doğru checkbox ile birlikte güncellenir.
              </StoneText>
              <StoneButton
                label="Kaynak notu aç"
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
            label={saving ? "Kaydediliyor…" : "Değişiklikleri kaydet"}
            onPress={() => void save()}
            disabled={saving || !title.trim()}
          />
          <StoneButton
            label="Takvimde planla"
            variant="secondary"
            onPress={() => void scheduleTask()}
          />
          <StoneText variant="caption">
            Zaman bloğu görev son tarihini veya tamamlanma durumunu değiştirmez.
          </StoneText>
          <View style={styles.subtasks}>
            <StoneText variant="title3">Alt görevler</StoneText>
            <View style={styles.addSubtask}>
              <StoneInput
                label="Yeni alt görev"
                value={subtaskTitle}
                onChangeText={setSubtaskTitle}
                containerStyle={styles.field}
                onSubmitEditing={() => void addSubtask()}
              />
              <StoneButton
                label="Ekle"
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
                    label="Yukarı"
                    variant="quiet"
                    onPress={() => void move(index, -1)}
                    disabled={index === 0}
                  />
                  <StoneButton
                    label="Aşağı"
                    variant="quiet"
                    onPress={() => void move(index, 1)}
                    disabled={index === subtasks.length - 1}
                  />
                  <StoneButton label="Sil" variant="quiet" onPress={() => remove(subtask)} />
                </View>
              </Surface>
            ))}
          </View>
          <StoneButton label="Görevi sil" variant="quiet" onPress={deleteTask} />
        </ResponsiveContent>
      </ScrollView>
    </Screen>
  );
}

function ChoiceSection({
  title,
  values,
  selected,
  onSelect,
}: {
  title: string;
  values: readonly string[];
  selected: string;
  onSelect: (value: string) => void;
}) {
  return (
    <View style={styles.choiceSection}>
      <StoneText variant="label">{title}</StoneText>
      <ScrollView horizontal contentContainerStyle={styles.choices}>
        {values.map((value) => (
          <Choice
            key={value}
            label={value}
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

function message(error: unknown): string {
  return error instanceof Error ? error.message : "Tekrar deneyin.";
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
