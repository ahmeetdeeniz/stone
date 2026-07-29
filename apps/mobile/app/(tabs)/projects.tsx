import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Alert, FlatList, Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import type { Project, ProjectPlatform, ProjectStatus, ProjectTask } from "@stone/domain";
import { projectPlatforms, projectPriorities, projectStatuses } from "@stone/domain";
import {
  formatInstant,
  formatProjectPlatform,
  formatProjectHealth,
  formatProjectPriority,
  formatProjectStatus,
  type TranslationKey,
} from "@stone/i18n";
import type { ProjectTemplate } from "@stone/markdown";
import { ResponsiveContent } from "../../src/components/responsive";
import { EmptyState, ErrorState, LoadingState } from "../../src/components/states";
import { Screen, StoneButton, StoneInput, StoneText, Surface } from "../../src/components/ui";
import { spacing } from "../../src/design/tokens";
import { useAuth } from "../../src/providers/auth-provider";
import { useAppServices } from "../../src/providers/app-provider";
import { createNewProjectWorkspace } from "../../src/projects/factory";
import { useI18n } from "../../src/i18n/provider";

const templates: readonly ProjectTemplate[] = [
  "blank",
  "general",
  "mobile_app",
  "game",
  "website",
  "programming_tooling",
];

interface ProjectListItem {
  project: Project;
  tasks: readonly ProjectTask[];
}

export default function ProjectsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { projectUseCases, deviceId } = useAppServices();
  const { locale, t } = useI18n();
  const [items, setItems] = useState<readonly ProjectListItem[]>([]);
  const [view, setView] = useState<"list" | "kanban">("list");
  const [statusFilter, setStatusFilter] = useState<ProjectStatus | undefined>();
  const [priorityFilter, setPriorityFilter] = useState<Project["priority"] | undefined>();
  const [tagFilter, setTagFilter] = useState("");
  const [platformFilter, setPlatformFilter] = useState<ProjectPlatform | undefined>();
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [template, setTemplate] = useState<ProjectTemplate>("general");
  const [createStatus, setCreateStatus] = useState<ProjectStatus>("planning");
  const [createPriority, setCreatePriority] = useState<Project["priority"]>("medium");
  const [createTags, setCreateTags] = useState("");
  const [createTargetDate, setCreateTargetDate] = useState("");
  const [createPlatforms, setCreatePlatforms] = useState<readonly ProjectPlatform[]>([]);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      setError(null);
      const projects = await projectUseCases.list(user.uid, {
        ...(statusFilter ? { status: statusFilter } : {}),
        ...(priorityFilter ? { priority: priorityFilter } : {}),
        ...(tagFilter ? { tag: tagFilter } : {}),
        ...(platformFilter ? { platform: platformFilter } : {}),
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
      setError(caught instanceof Error ? caught.message : t("projects.listLoadFailed"));
    } finally {
      setLoading(false);
    }
  }, [platformFilter, priorityFilter, projectUseCases, search, statusFilter, tagFilter, user]);

  useFocusEffect(useCallback(() => void load(), [load]));

  const createProject = async () => {
    if (!user || !title.trim()) return;
    setBusy(true);
    try {
      const workspace = createNewProjectWorkspace({
        ownerId: user.uid,
        title,
        template,
        deviceId,
        status: createStatus,
        priority: createPriority,
        tags: createTags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
        targetDate: createTargetDate.trim() || null,
        platforms: createPlatforms,
      });
      const project = await projectUseCases.create(workspace);
      setCreateOpen(false);
      setTitle("");
      await load();
      router.push({ pathname: "/project/[id]", params: { id: project.id } });
    } catch (caught) {
      Alert.alert(
        t("projects.createFailed"),
        caught instanceof Error ? caught.message : t("notes.localSaveFailed"),
      );
    } finally {
      setBusy(false);
    }
  };

  const changeStatus = (project: Project) => {
    Alert.alert(
      t("projects.statusTitle"),
      t("projects.chooseStatus", { project: project.title }),
      projectStatuses.map((status) => ({
        text: formatProjectStatus(locale, status),
        onPress: () =>
          void projectUseCases
            .update(user!.uid, project.id, { status }, deviceId)
            .then(load)
            .catch((caught: unknown) =>
              Alert.alert(
                t("projects.statusUpdateFailed"),
                caught instanceof Error ? caught.message : t("app.unknownError"),
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
            <StoneText variant="title1">{t("tabs.projects")}</StoneText>
          </View>
          <View style={styles.headerActions}>
            <StoneButton
              label={view === "list" ? t("projects.kanbanView") : t("projects.listView")}
              variant="secondary"
              onPress={() => setView(view === "list" ? "kanban" : "list")}
            />
            <StoneButton
              label={t("projects.new")}
              onPress={() => setCreateOpen(true)}
              disabled={busy}
            />
          </View>
        </View>
        <StoneInput
          label={t("projects.search")}
          value={search}
          onChangeText={setSearch}
          placeholder={t("projects.searchPlaceholder")}
        />
        <StoneInput
          label={t("projects.tagFilter")}
          value={tagFilter}
          onChangeText={setTagFilter}
          placeholder={t("projects.tagPlaceholder")}
          autoCapitalize="none"
        />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filters}
        >
          <StoneButton
            label={
              statusFilter ? formatProjectStatus(locale, statusFilter) : t("projects.allStatuses")
            }
            variant="secondary"
            onPress={() => cycleStatusFilter()}
          />
          <StoneButton
            label={
              priorityFilter
                ? formatProjectPriority(locale, priorityFilter)
                : t("projects.allPriorities")
            }
            variant="secondary"
            onPress={() => cyclePriorityFilter()}
          />
          <StoneButton
            label={
              platformFilter
                ? t("projects.platformFilter", {
                    platform: formatProjectPlatform(locale, platformFilter),
                  })
                : t("projects.allPlatforms")
            }
            variant="secondary"
            onPress={() => cyclePlatformFilter()}
          />
          {statusFilter || priorityFilter || tagFilter || platformFilter ? (
            <StoneButton
              label={t("projects.clearFilters")}
              variant="quiet"
              onPress={() => {
                setStatusFilter(undefined);
                setPriorityFilter(undefined);
                setTagFilter("");
                setPlatformFilter(undefined);
              }}
            />
          ) : null}
        </ScrollView>
        {loading ? (
          <LoadingState label={t("projects.loading")} />
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
                  {formatProjectStatus(locale, column.status)} ({column.items.length})
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
              <EmptyState title={t("projects.empty")} description={t("projects.emptyDetail")} />
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
              <StoneText variant="title1">{t("projects.new")}</StoneText>
              <StoneInput
                label={t("projects.name")}
                value={title}
                onChangeText={setTitle}
                autoFocus
                placeholder={t("projects.namePlaceholder")}
              />
              <StoneText variant="label">{t("projects.template")}</StoneText>
              <View style={styles.choices}>
                {templates.map((option) => (
                  <StoneButton
                    key={option}
                    label={t(`projects.template.${option}` as TranslationKey)}
                    variant={template === option ? "primary" : "secondary"}
                    onPress={() => setTemplate(option)}
                  />
                ))}
              </View>
              <StoneText variant="label">{t("projects.initialStatus")}</StoneText>
              <View style={styles.choices}>
                {projectStatuses.map((option) => (
                  <StoneButton
                    key={option}
                    label={formatProjectStatus(locale, option)}
                    variant={createStatus === option ? "primary" : "secondary"}
                    onPress={() => setCreateStatus(option)}
                  />
                ))}
              </View>
              <StoneText variant="label">{t("projects.priority")}</StoneText>
              <View style={styles.choices}>
                {projectPriorities.map((option) => (
                  <StoneButton
                    key={option}
                    label={formatProjectPriority(locale, option)}
                    variant={createPriority === option ? "primary" : "secondary"}
                    onPress={() => setCreatePriority(option)}
                  />
                ))}
              </View>
              <StoneInput
                label={t("projects.tagsField")}
                value={createTags}
                onChangeText={setCreateTags}
                placeholder={t("projects.tagsPlaceholder")}
              />
              <StoneInput
                label={t("projects.targetDateField")}
                value={createTargetDate}
                onChangeText={setCreateTargetDate}
                placeholder="2026-09-30"
              />
              <StoneText variant="label">{t("projects.platforms")}</StoneText>
              <View style={styles.choices}>
                {projectPlatforms.map((platform) => (
                  <StoneButton
                    key={platform}
                    label={formatProjectPlatform(locale, platform)}
                    variant={createPlatforms.includes(platform) ? "primary" : "secondary"}
                    onPress={() =>
                      setCreatePlatforms((current) =>
                        current.includes(platform)
                          ? current.filter((item) => item !== platform)
                          : [...current, platform],
                      )
                    }
                  />
                ))}
              </View>
              <StoneButton
                label={t("common.create")}
                onPress={() => void createProject()}
                disabled={busy || !title.trim()}
              />
              <StoneButton
                label={t("common.cancel")}
                variant="quiet"
                onPress={() => setCreateOpen(false)}
              />
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

  function cyclePlatformFilter() {
    const current = platformFilter ? projectPlatforms.indexOf(platformFilter) : -1;
    const next = current + 1;
    setPlatformFilter(next >= projectPlatforms.length ? undefined : projectPlatforms[next]);
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
  const { locale, t } = useI18n();
  const completed = tasks.filter((task) => task.completed && !task.canceled).length;
  const total = tasks.filter((task) => !task.canceled).length;
  return (
    <Surface>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("projects.openA11y", { title: project.title })}
        onPress={onOpen}
      >
        <StoneText variant="title3">{project.title}</StoneText>
        <StoneText variant="bodySmall">
          {project.currentVersion ?? t("projects.noVersion")} →{" "}
          {project.nextVersion ?? t("projects.noNextVersion")}
        </StoneText>
        <StoneText variant="caption" style={{ marginTop: spacing.xs }}>
          {formatProjectStatus(locale, project.status)} ·{" "}
          {formatProjectPriority(locale, project.priority)} ·{" "}
          {t("projects.health", { health: formatProjectHealth(locale, project.health) })}
        </StoneText>
        <StoneText variant="bodySmall" style={{ marginTop: spacing.xs }}>
          {t("projects.tasksProgress", { completed, total })} ·{" "}
          {project.targetDate
            ? t("projects.targetDate", { date: project.targetDate })
            : t("projects.noTargetDate")}
        </StoneText>
        <StoneText variant="bodySmall" numberOfLines={2} style={{ marginTop: spacing.xs }}>
          {project.nextAction ?? t("projects.noNextAction")}
        </StoneText>
        <StoneText variant="caption" style={{ marginTop: spacing.xs }}>
          {t("projects.updatedAt", {
            date: formatInstant(
              locale,
              project.updatedAt,
              Intl.DateTimeFormat().resolvedOptions().timeZone,
              { dateStyle: "medium" },
            ),
          })}
        </StoneText>
      </Pressable>
      <View style={styles.cardActions}>
        <StoneButton label={t("projects.changeStatus")} variant="quiet" onPress={onStatus} />
        <StoneButton label={t("common.open")} variant="quiet" onPress={onOpen} />
      </View>
    </Surface>
  );
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
