import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Alert, FlatList, Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import type { Project, ProjectStatus, ProjectTask } from "@stone/domain";
import {
  projectPriorities,
  projectPriorityLabels,
  projectStatuses,
  projectStatusLabels,
} from "@stone/domain";
import type { ProjectTemplate } from "@stone/markdown";
import { ResponsiveContent } from "../../src/components/responsive";
import { EmptyState, ErrorState, LoadingState } from "../../src/components/states";
import { Screen, StoneButton, StoneInput, StoneText, Surface } from "../../src/components/ui";
import { spacing } from "../../src/design/tokens";
import { useAuth } from "../../src/providers/auth-provider";
import { useAppServices } from "../../src/providers/app-provider";
import { createNewProjectWorkspace } from "../../src/projects/factory";

const templates: readonly { id: ProjectTemplate; label: string }[] = [
  { id: "general", label: "Genel Proje" },
  { id: "mobile_app", label: "Mobil Uygulama" },
  { id: "game", label: "Oyun" },
  { id: "website", label: "Web Sitesi" },
  { id: "programming_tooling", label: "Programlama Dili / Tooling" },
];

interface ProjectListItem {
  project: Project;
  tasks: readonly ProjectTask[];
}

export default function ProjectsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { projectUseCases, deviceId } = useAppServices();
  const [items, setItems] = useState<readonly ProjectListItem[]>([]);
  const [view, setView] = useState<"list" | "kanban">("list");
  const [statusFilter, setStatusFilter] = useState<ProjectStatus | undefined>();
  const [priorityFilter, setPriorityFilter] = useState<Project["priority"] | undefined>();
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [template, setTemplate] = useState<ProjectTemplate>("general");

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      setError(null);
      const projects = await projectUseCases.list(user.uid, {
        ...(statusFilter ? { status: statusFilter } : {}),
        ...(priorityFilter ? { priority: priorityFilter } : {}),
        ...(search ? { search } : {}),
      });
      setItems(
        await Promise.all(
          projects.map(async (project) => ({
            project,
            tasks: await projectUseCases.tasks(user.uid, project.id),
          })),
        ),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Projeler okunamadı.");
    } finally {
      setLoading(false);
    }
  }, [priorityFilter, projectUseCases, search, statusFilter, user]);

  useFocusEffect(useCallback(() => void load(), [load]));

  const createProject = async () => {
    if (!user || !title.trim()) return;
    setBusy(true);
    try {
      const workspace = createNewProjectWorkspace({ ownerId: user.uid, title, template, deviceId });
      const project = await projectUseCases.create(workspace);
      setCreateOpen(false);
      setTitle("");
      await load();
      router.push({ pathname: "/project/[id]", params: { id: project.id } });
    } catch (caught) {
      Alert.alert(
        "Proje oluşturulamadı",
        caught instanceof Error ? caught.message : "Yerel kayıt başarısız.",
      );
    } finally {
      setBusy(false);
    }
  };

  const changeStatus = (project: Project) => {
    Alert.alert(
      "Proje durumu",
      `${project.title} için yeni durumu seçin.`,
      projectStatuses.map((status) => ({
        text: projectStatusLabels[status],
        onPress: () =>
          void projectUseCases
            .update(user!.uid, project.id, { status }, deviceId)
            .then(load)
            .catch((caught: unknown) =>
              Alert.alert(
                "Durum güncellenemedi",
                caught instanceof Error ? caught.message : "Tekrar deneyin.",
              ),
            ),
      })),
    );
  };

  const columns = useMemo(
    () =>
      projectStatuses.map((status) => ({
        status,
        items: items.filter((item) => item.project.status === status),
      })),
    [items],
  );

  return (
    <Screen>
      <ResponsiveContent>
        <View style={styles.header}>
          <View>
            <StoneText variant="display">Stone</StoneText>
            <StoneText variant="title1">Projeler</StoneText>
          </View>
          <View style={styles.headerActions}>
            <StoneButton
              label={view === "list" ? "Kanban" : "Liste"}
              variant="secondary"
              onPress={() => setView(view === "list" ? "kanban" : "list")}
            />
            <StoneButton label="Yeni proje" onPress={() => setCreateOpen(true)} disabled={busy} />
          </View>
        </View>
        <StoneInput
          label="Projelerde ara"
          value={search}
          onChangeText={setSearch}
          placeholder="Başlık veya sonraki iş"
        />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filters}
        >
          <StoneButton
            label={statusFilter ? projectStatusLabels[statusFilter] : "Tüm durumlar"}
            variant="secondary"
            onPress={() => cycleStatusFilter()}
          />
          <StoneButton
            label={priorityFilter ? projectPriorityLabels[priorityFilter] : "Tüm öncelikler"}
            variant="secondary"
            onPress={() => cyclePriorityFilter()}
          />
          {statusFilter || priorityFilter ? (
            <StoneButton
              label="Filtreleri temizle"
              variant="quiet"
              onPress={() => {
                setStatusFilter(undefined);
                setPriorityFilter(undefined);
              }}
            />
          ) : null}
        </ScrollView>
        {loading ? (
          <LoadingState label="Projeler yükleniyor" />
        ) : error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : view === "kanban" ? (
          <ScrollView
            horizontal
            style={styles.kanban}
            contentContainerStyle={styles.kanbanContent}
            showsHorizontalScrollIndicator={false}
          >
            {columns.map((column) => (
              <View key={column.status} style={styles.column}>
                <StoneText variant="label">
                  {projectStatusLabels[column.status]} ({column.items.length})
                </StoneText>
                {column.items.map((item) => (
                  <ProjectCard
                    key={item.project.id}
                    item={item}
                    onOpen={() =>
                      router.push({ pathname: "/project/[id]", params: { id: item.project.id } })
                    }
                    onStatus={() => changeStatus(item.project)}
                  />
                ))}
              </View>
            ))}
          </ScrollView>
        ) : (
          <FlatList
            data={items}
            keyExtractor={(item) => item.project.id}
            contentContainerStyle={items.length === 0 ? styles.emptyList : styles.list}
            ListEmptyComponent={
              <EmptyState
                title="İlk projeni oluştur"
                description="Şablon seçerek Markdown-backed bir proje alanı başlatın."
              />
            }
            renderItem={({ item }) => (
              <ProjectCard
                item={item}
                onOpen={() =>
                  router.push({ pathname: "/project/[id]", params: { id: item.project.id } })
                }
                onStatus={() => changeStatus(item.project)}
              />
            )}
          />
        )}
        <Modal
          visible={createOpen}
          animationType="slide"
          onRequestClose={() => setCreateOpen(false)}
        >
          <Screen>
            <ScrollView contentContainerStyle={styles.modalContent}>
              <StoneText variant="title1">Yeni proje</StoneText>
              <StoneInput
                label="Proje adı"
                value={title}
                onChangeText={setTitle}
                autoFocus
                placeholder="Örn. Kelime Zinciri"
              />
              <StoneText variant="label">Şablon</StoneText>
              <View style={styles.choices}>
                {templates.map((option) => (
                  <StoneButton
                    key={option.id}
                    label={option.label}
                    variant={template === option.id ? "primary" : "secondary"}
                    onPress={() => setTemplate(option.id)}
                  />
                ))}
              </View>
              <StoneButton
                label="Oluştur"
                onPress={() => void createProject()}
                disabled={busy || !title.trim()}
              />
              <StoneButton label="Vazgeç" variant="quiet" onPress={() => setCreateOpen(false)} />
            </ScrollView>
          </Screen>
        </Modal>
      </ResponsiveContent>
    </Screen>
  );

  function cycleStatusFilter() {
    const current = statusFilter ? projectStatuses.indexOf(statusFilter) : -1;
    const next = current + 1;
    setStatusFilter(next >= projectStatuses.length ? undefined : projectStatuses[next]);
  }

  function cyclePriorityFilter() {
    const current = priorityFilter ? projectPriorities.indexOf(priorityFilter) : -1;
    const next = current + 1;
    setPriorityFilter(next >= projectPriorities.length ? undefined : projectPriorities[next]);
  }
}

function ProjectCard({
  item,
  onOpen,
  onStatus,
}: {
  item: ProjectListItem;
  onOpen: () => void;
  onStatus: () => void;
}) {
  const { project, tasks } = item;
  const completed = tasks.filter((task) => task.completed && !task.canceled).length;
  const total = tasks.filter((task) => !task.canceled).length;
  return (
    <Surface>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${project.title} projesini aç`}
        onPress={onOpen}
      >
        <StoneText variant="title3">{project.title}</StoneText>
        <StoneText variant="bodySmall">
          {project.currentVersion ?? "Sürüm yok"} → {project.nextVersion ?? "Sonraki sürüm yok"}
        </StoneText>
        <StoneText variant="caption" style={{ marginTop: spacing.xs }}>
          {projectStatusLabels[project.status]} · {projectPriorityLabels[project.priority]} ·
          Sağlık: {project.health}
        </StoneText>
        <StoneText variant="bodySmall" style={{ marginTop: spacing.xs }}>
          {completed}/{total} görev ·{" "}
          {project.targetDate ? `Hedef ${project.targetDate}` : "Hedef tarih yok"}
        </StoneText>
        <StoneText variant="bodySmall" numberOfLines={2} style={{ marginTop: spacing.xs }}>
          {project.nextAction ?? "Sonraki iş belirlenmedi."}
        </StoneText>
        <StoneText variant="caption" style={{ marginTop: spacing.xs }}>
          Son güncelleme: {formatDate(project.updatedAt)}
        </StoneText>
      </Pressable>
      <View style={styles.cardActions}>
        <StoneButton label="Durumu değiştir" variant="quiet" onPress={onStatus} />
        <StoneButton label="Aç" variant="quiet" onPress={onOpen} />
      </View>
    </Surface>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium" }).format(new Date(value));
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  headerActions: {
    flexDirection: "row",
    gap: spacing.sm,
    flexWrap: "wrap",
    justifyContent: "flex-end",
  },
  filters: { gap: spacing.sm, paddingVertical: spacing.sm },
  list: { gap: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.giant },
  emptyList: { flexGrow: 1 },
  cardActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  kanban: { flex: 1 },
  kanbanContent: { gap: spacing.md, paddingVertical: spacing.md, paddingBottom: spacing.giant },
  column: { width: 260, gap: spacing.sm },
  modalContent: { gap: spacing.lg, paddingBottom: spacing.giant },
  choices: { gap: spacing.sm },
});
