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
import { ResponsiveContent } from "../../src/components/responsive";
import { EmptyState, ErrorState, LoadingState } from "../../src/components/states";
import { Screen, StoneButton, StoneInput, StoneText, Surface } from "../../src/components/ui";
import { spacing } from "../../src/design/tokens";
import { useAuth } from "../../src/providers/auth-provider";
import { useAppServices } from "../../src/providers/app-provider";

type ViewFilter = "all" | "today" | "upcoming" | "overdue" | "completed";

const FILTER_LABELS: Readonly<Record<ViewFilter, string>> = {
  all: "Tümü",
  today: "Bugün",
  upcoming: "Yaklaşan",
  overdue: "Geciken",
  completed: "Tamamlanan",
};

export default function TodayScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { taskUseCases, projectUseCases, calendar, deviceId } = useAppServices();
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
      setError(caught instanceof Error ? caught.message : "Planlama görünümü yüklenemedi.");
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
      Alert.alert("Görev eklenemedi", message(caught));
    }
  };

  const toggle = async (task: Task) => {
    if (!user) return;
    try {
      if (task.state === "completed") await taskUseCases.reopen(user.uid, task.id, deviceId);
      else await taskUseCases.complete(user.uid, task.id, new Date().toISOString(), deviceId);
      await load();
    } catch (caught) {
      Alert.alert("Görev güncellenemedi", message(caught));
    }
  };

  const subtitle = useMemo(
    () => `${tasks.length} görev · Çevrimdışı değişiklikler cihazda korunur`,
    [tasks.length],
  );

  return (
    <Screen padded={false}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.page}>
        <ResponsiveContent>
          <StoneText variant="title1">Planlama</StoneText>
          <StoneText variant="bodySmall" style={styles.subtitle}>
            {subtitle}
          </StoneText>
          <View style={styles.quickAdd}>
            <StoneInput
              label="Hızlı görev ekle"
              value={capture}
              onChangeText={setCapture}
              placeholder="Yapılacak işi yaz"
              returnKeyType="done"
              onSubmitEditing={() => void quickAdd()}
            />
            <StoneButton
              label="Görev ekle"
              onPress={() => void quickAdd()}
              disabled={!capture.trim()}
            />
          </View>
          <StoneInput
            label="Görevlerde ara"
            value={search}
            onChangeText={setSearch}
            placeholder="Başlık, açıklama veya etiket"
            returnKeyType="search"
          />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filters}
          >
            {(Object.keys(FILTER_LABELS) as ViewFilter[]).map((value) => (
              <Pressable
                key={value}
                accessibilityRole="button"
                accessibilityState={{ selected: filter === value }}
                accessibilityLabel={`${FILTER_LABELS[value]} görevlerini göster`}
                onPress={() => setFilter(value)}
                style={[styles.filter, filter === value && styles.filterActive]}
              >
                <StoneText variant="label">{FILTER_LABELS[value]}</StoneText>
              </Pressable>
            ))}
          </ScrollView>
          {filter === "today" && agendaItems.length > 0 ? (
            <View style={styles.signals}>
              <StoneText variant="title3">Bugünün zaman çizelgesi</StoneText>
              {agendaItems.map((item) => (
                <Surface key={item.id}>
                  <StoneText variant="caption">{agendaLabel(item.kind)}</StoneText>
                  <StoneText>{item.title}</StoneText>
                  <StoneText variant="caption">
                    {item.sortTime ?? "Tüm gün"}
                    {item.completed ? " · Tamamlandı" : ""}
                  </StoneText>
                </Surface>
              ))}
            </View>
          ) : null}
          {loading ? (
            <LoadingState label="Görevler yükleniyor" />
          ) : error ? (
            <ErrorState message={error} onRetry={() => void load()} />
          ) : tasks.length === 0 ? (
            <EmptyState
              title="Bu görünüm sakin"
              description="Filtreye uyan görev yok. Hızlı ekleme alanından yeni bir görev oluşturabilirsin."
            />
          ) : (
            <View style={styles.list}>
              {tasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  onToggle={() => void toggle(task)}
                  onOpen={() =>
                    router.push({ pathname: "/task/[id]" as never, params: { id: task.id } })
                  }
                />
              ))}
            </View>
          )}
          {filter === "today" && signals.length > 0 ? (
            <View style={styles.signals}>
              <StoneText variant="title3">Proje sinyalleri</StoneText>
              {signals.map((item) => (
                <Surface key={item.id}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${item.projectTitle} projesini aç`}
                    onPress={() =>
                      router.push({ pathname: "/project/[id]", params: { id: item.projectId } })
                    }
                  >
                    <StoneText variant="caption">{item.projectTitle}</StoneText>
                    <StoneText>{item.text}</StoneText>
                    <StoneText variant="caption">
                      {item.blocked ? "Blocker · " : ""}
                      {item.dueDate ?? "Tarihsiz"}
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

function agendaLabel(kind: AgendaItem["kind"]): string {
  return {
    event: "Etkinlik",
    task_block: "Planlanmış görev bloğu",
    task_due: "Görev son tarihi",
    project_milestone: "Proje hedef tarihi",
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
  return (
    <Surface>
      <View style={styles.taskRow}>
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: completed }}
          accessibilityLabel={`${task.title} görevini ${completed ? "yeniden aç" : "tamamla"}`}
          onPress={onToggle}
          style={[styles.checkbox, completed && styles.checkboxChecked]}
        >
          <StoneText variant="label">{completed ? "✓" : ""}</StoneText>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${task.title} görevini düzenle`}
          onPress={onOpen}
          style={styles.taskBody}
        >
          <StoneText variant="body">{task.title}</StoneText>
          <StoneText variant="caption">
            {task.priority !== "none" ? `${task.priority} öncelik · ` : ""}
            {task.dueDate ?? "Tarihsiz"}
            {task.dueTime ? ` ${task.dueTime}` : ""}
            {task.sourceDocumentId ? " · Markdown bağlantılı" : ""}
          </StoneText>
          {completed ? <StoneText variant="caption">Durum: Tamamlandı</StoneText> : null}
        </Pressable>
      </View>
    </Surface>
  );
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "Tekrar deneyin.";
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
