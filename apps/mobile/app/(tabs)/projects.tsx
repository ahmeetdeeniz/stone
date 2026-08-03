import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Alert, FlatList, Modal, ScrollView, StyleSheet, View } from "react-native";
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
import {
  Badge,
  Card,
  Chip,
  IconButton,
  Overline,
  ProgressBar,
  Screen,
  ScreenHeader,
  SearchField,
  StoneButton,
  StoneInput,
  StoneText,
} from "../../src/components/ui";
import { spacing } from "../../src/design/tokens";
import type { StatusTone } from "../../src/design/tokens";
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

const statusTone: Readonly<Record<ProjectStatus, StatusTone>> = {
  idea: "neutral",
  planning: "info",
  development: "accent",
  testing: "info",
  store_process: "warning",
  live: "success",
  update_needed: "warning",
  maintenance: "neutral",
  paused: "neutral",
  archived: "neutral",
};

const priorityTone: Readonly<Record<Project["priority"], StatusTone>> = {
  low: "neutral",
  medium: "neutral",
  high: "warning",
  critical: "danger",
};

interface ProjectListItem {
  project: Project;
  tasks: readonly ProjectTask[];
}

export default function ProjectsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { projectUseCases, deviceId } = useAppServices();
  const { locale, t, tp } = useI18n();
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

  const filtersActive = Boolean(statusFilter || priorityFilter || tagFilter || platformFilter);

  return (
    <Screen>
      <ResponsiveContent>
        <ScreenHeader
          eyebrow="Stone"
          title={t("tabs.projects")}
          subtitle={loading ? undefined : tp("projects.count", items.length)}
          actions={
            <>
              <IconButton
                icon={view === "list" ? "grid-outline" : "list-outline"}
                accessibilityLabel={
                  view === "list" ? t("projects.kanbanView") : t("projects.listView")
                }
                onPress={() => setView(view === "list" ? "kanban" : "list")}
              />
              <StoneButton
                label={t("projects.new")}
                icon="add"
                size="sm"
                onPress={() => setCreateOpen(true)}
                disabled={busy}
              />
            </>
          }
        />
        <View style={styles.searchRow}>
          <SearchField
            value={search}
            onChangeText={setSearch}
            placeholder={t("projects.searchPlaceholder")}
            accessibilityLabel={t("projects.search")}
            onClear={() => setSearch("")}
          />
          <SearchField
            value={tagFilter}
            onChangeText={setTagFilter}
            placeholder={t("projects.tagPlaceholder")}
            accessibilityLabel={t("projects.tagFilter")}
            onClear={() => setTagFilter("")}
            icon="pricetag-outline"
            autoCapitalize="none"
          />
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filters}
        >
          <Chip
            label={
              statusFilter ? formatProjectStatus(locale, statusFilter) : t("projects.allStatuses")
            }
            selected={Boolean(statusFilter)}
            icon="flag-outline"
            onPress={cycleStatusFilter}
          />
          <Chip
            label={
              priorityFilter
                ? formatProjectPriority(locale, priorityFilter)
                : t("projects.allPriorities")
            }
            selected={Boolean(priorityFilter)}
            icon="arrow-up-circle-outline"
            onPress={cyclePriorityFilter}
          />
          <Chip
            label={
              platformFilter
                ? formatProjectPlatform(locale, platformFilter)
                : t("projects.allPlatforms")
            }
            selected={Boolean(platformFilter)}
            icon="phone-portrait-outline"
            onPress={cyclePlatformFilter}
          />
          {filtersActive ? (
            <Chip
              label={t("projects.clearFilters")}
              icon="close"
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
                <View style={styles.columnHead}>
                  <Overline>{formatProjectStatus(locale, column.status)}</Overline>
                  <StoneText variant="caption" tone="muted">
                    {String(column.items.length)}
                  </StoneText>
                </View>
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
            showsVerticalScrollIndicator={false}
            contentContainerStyle={items.length === 0 ? styles.emptyList : styles.list}
            ListEmptyComponent={
              <EmptyState
                icon="layers-outline"
                title={t("projects.empty")}
                description={t("projects.emptyDetail")}
                action={
                  <StoneButton
                    label={t("projects.new")}
                    icon="add"
                    onPress={() => setCreateOpen(true)}
                  />
                }
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
          presentationStyle="pageSheet"
          onRequestClose={() => setCreateOpen(false)}
        >
          <Screen>
            <ScrollView
              contentContainerStyle={styles.modalContent}
              showsVerticalScrollIndicator={false}
            >
              <ScreenHeader
                title={t("projects.new")}
                actions={
                  <IconButton
                    icon="close"
                    accessibilityLabel={t("common.cancel")}
                    onPress={() => setCreateOpen(false)}
                  />
                }
              />
              <StoneInput
                label={t("projects.name")}
                value={title}
                onChangeText={setTitle}
                autoFocus
                placeholder={t("projects.namePlaceholder")}
              />
              <OptionGroup label={t("projects.template")}>
                {templates.map((option) => (
                  <Chip
                    key={option}
                    label={t(`projects.template.${option}` as TranslationKey)}
                    selected={template === option}
                    onPress={() => setTemplate(option)}
                  />
                ))}
              </OptionGroup>
              <OptionGroup label={t("projects.initialStatus")}>
                {projectStatuses.map((option) => (
                  <Chip
                    key={option}
                    label={formatProjectStatus(locale, option)}
                    selected={createStatus === option}
                    onPress={() => setCreateStatus(option)}
                  />
                ))}
              </OptionGroup>
              <OptionGroup label={t("projects.priority")}>
                {projectPriorities.map((option) => (
                  <Chip
                    key={option}
                    label={formatProjectPriority(locale, option)}
                    selected={createPriority === option}
                    onPress={() => setCreatePriority(option)}
                  />
                ))}
              </OptionGroup>
              <StoneInput
                label={t("projects.tagsField")}
                value={createTags}
                onChangeText={setCreateTags}
                placeholder={t("projects.tagsPlaceholder")}
                icon="pricetags-outline"
              />
              <StoneInput
                label={t("projects.targetDateField")}
                value={createTargetDate}
                onChangeText={setCreateTargetDate}
                placeholder="2026-09-30"
                icon="calendar-outline"
              />
              <OptionGroup label={t("projects.platforms")}>
                {projectPlatforms.map((platform) => (
                  <Chip
                    key={platform}
                    label={formatProjectPlatform(locale, platform)}
                    selected={createPlatforms.includes(platform)}
                    onPress={() =>
                      setCreatePlatforms((current) =>
                        current.includes(platform)
                          ? current.filter((item) => item !== platform)
                          : [...current, platform],
                      )
                    }
                  />
                ))}
              </OptionGroup>
              <View style={styles.modalActions}>
                <StoneButton
                  label={t("common.create")}
                  icon="checkmark"
                  onPress={() => void createProject()}
                  disabled={busy || !title.trim()}
                />
                <StoneButton
                  label={t("common.cancel")}
                  variant="quiet"
                  onPress={() => setCreateOpen(false)}
                />
              </View>
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

function OptionGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.optionGroup}>
      <Overline>{label}</Overline>
      <View style={styles.choices}>{children}</View>
    </View>
  );
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
  const progress = total === 0 ? 0 : completed / total;
  return (
    <Card accessibilityLabel={t("projects.openA11y", { title: project.title })} onPress={onOpen}>
      <View style={styles.cardHead}>
        <StoneText variant="title3" numberOfLines={2} style={styles.cardTitle}>
          {project.title}
        </StoneText>
        <IconButton
          icon="swap-horizontal-outline"
          accessibilityLabel={t("projects.changeStatus")}
          onPress={onStatus}
        />
      </View>
      <View style={styles.badgeRow}>
        <Badge
          label={formatProjectStatus(locale, project.status)}
          tone={statusTone[project.status]}
        />
        <Badge
          label={formatProjectPriority(locale, project.priority)}
          tone={priorityTone[project.priority]}
        />
        <Badge
          label={t("projects.health", { health: formatProjectHealth(locale, project.health) })}
          tone="neutral"
        />
      </View>
      <View style={styles.progressBlock}>
        <View style={styles.progressLabels}>
          <StoneText variant="caption" tone="secondary">
            {t("projects.tasksProgress", { completed, total })}
          </StoneText>
          <StoneText variant="caption" tone="muted">
            {project.targetDate
              ? t("projects.targetDate", { date: project.targetDate })
              : t("projects.noTargetDate")}
          </StoneText>
        </View>
        <ProgressBar
          value={progress}
          accessibilityLabel={t("projects.tasksProgress", { completed, total })}
        />
      </View>
      <StoneText variant="bodySmall" tone="secondary" numberOfLines={2}>
        {project.nextAction ?? t("projects.noNextAction")}
      </StoneText>
      <View style={styles.cardFooter}>
        <StoneText variant="caption" tone="muted" numberOfLines={1} style={styles.cardTitle}>
          {project.currentVersion ?? t("projects.noVersion")} →{" "}
          {project.nextVersion ?? t("projects.noNextVersion")}
        </StoneText>
        <StoneText variant="caption" tone="muted">
          {formatInstant(
            locale,
            project.updatedAt,
            Intl.DateTimeFormat().resolvedOptions().timeZone,
            { dateStyle: "medium" },
          )}
        </StoneText>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  searchRow: { gap: spacing.sm, marginBottom: spacing.xs },
  filters: { gap: spacing.sm, paddingVertical: spacing.md, paddingRight: spacing.lg },
  list: { gap: spacing.md, paddingTop: spacing.xs, paddingBottom: spacing.giant },
  emptyList: { flexGrow: 1 },
  cardHead: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  cardTitle: { flex: 1 },
  badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.sm },
  progressBlock: { gap: spacing.xs, marginVertical: spacing.md },
  progressLabels: { flexDirection: "row", justifyContent: "space-between", gap: spacing.sm },
  cardFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  kanban: { flex: 1 },
  kanbanContent: { gap: spacing.md, paddingVertical: spacing.md, paddingBottom: spacing.giant },
  column: { width: 272, gap: spacing.sm },
  columnHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.xs,
    paddingBottom: spacing.xs,
  },
  modalContent: { gap: spacing.lg, paddingBottom: spacing.giant },
  modalActions: { gap: spacing.sm, marginTop: spacing.sm },
  optionGroup: { gap: spacing.sm },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
});
