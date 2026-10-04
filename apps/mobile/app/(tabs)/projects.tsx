import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Alert, FlatList, Modal, ScrollView, StyleSheet, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { Project, ProjectPlatform, ProjectStatus, ProjectTask } from "@stone/domain";
import { projectPlatforms, projectPriorities, projectStatuses } from "@stone/domain";
import {
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
  ActionSheet,
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
import { useTheme } from "../../src/design/theme";
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
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [statusSheetFor, setStatusSheetFor] = useState<Project | null>(null);
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

  const changeStatus = (project: Project) => setStatusSheetFor(project);
  const applyStatus = (project: Project, status: ProjectStatus) =>
    void projectUseCases
      .update(user!.uid, project.id, { status }, deviceId)
      .then(load)
      .catch((caught: unknown) =>
        Alert.alert(
          t("projects.statusUpdateFailed"),
          caught instanceof Error ? caught.message : t("app.unknownError"),
        ),
      );

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
          title={t("tabs.projects")}
          subtitle={loading ? undefined : tp("projects.count", items.length)}
          actions={
            <>
              <IconButton
                icon="options-outline"
                active={filtersOpen || filtersActive}
                accessibilityLabel={t("projects.filters")}
                onPress={() => setFiltersOpen((open) => !open)}
              />
              <IconButton
                icon={view === "list" ? "grid-outline" : "list-outline"}
                accessibilityLabel={
                  view === "list" ? t("projects.kanbanView") : t("projects.listView")
                }
                onPress={() => setView(view === "list" ? "kanban" : "list")}
              />
              <IconButton
                icon="add"
                tone="accent"
                active
                accessibilityLabel={t("projects.new")}
                onPress={() => setCreateOpen(true)}
                disabled={busy}
              />
            </>
          }
        />
        <SearchField
          value={search}
          onChangeText={setSearch}
          placeholder={t("projects.searchPlaceholder")}
          accessibilityLabel={t("projects.search")}
          onClear={() => setSearch("")}
        />
        {filtersOpen ? (
          <View style={styles.filterPanel}>
            <FilterRow
              label={t("projects.statusTitle")}
              options={projectStatuses.map((value) => ({
                value,
                label: formatProjectStatus(locale, value),
              }))}
              value={statusFilter}
              onChange={setStatusFilter}
            />
            <FilterRow
              label={t("projects.priority")}
              options={projectPriorities.map((value) => ({
                value,
                label: formatProjectPriority(locale, value),
              }))}
              value={priorityFilter}
              onChange={setPriorityFilter}
            />
            <FilterRow
              label={t("projects.platforms")}
              options={projectPlatforms.map((value) => ({
                value,
                label: formatProjectPlatform(locale, value),
              }))}
              value={platformFilter}
              onChange={setPlatformFilter}
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
            {filtersActive ? (
              <StoneButton
                label={t("projects.clearFilters")}
                variant="quiet"
                size="sm"
                icon="close"
                onPress={() => {
                  setStatusFilter(undefined);
                  setPriorityFilter(undefined);
                  setTagFilter("");
                  setPlatformFilter(undefined);
                }}
              />
            ) : null}
          </View>
        ) : null}
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
      <ActionSheet
        visible={statusSheetFor !== null}
        title={statusSheetFor ? t("projects.chooseStatus", { project: statusSheetFor.title }) : ""}
        onClose={() => setStatusSheetFor(null)}
        options={
          statusSheetFor
            ? projectStatuses.map((status) => ({
                label: formatProjectStatus(locale, status),
                icon:
                  status === statusSheetFor.status
                    ? ("checkmark" as const)
                    : ("ellipse-outline" as const),
                onPress: () => applyStatus(statusSheetFor, status),
              }))
            : []
        }
      />
    </Screen>
  );
}

/** One filter dimension: tap a value to filter by it, tap it again to clear. */
function FilterRow<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T | undefined;
  onChange: (value: T | undefined) => void;
}) {
  return (
    <View style={styles.optionGroup}>
      <Overline>{label}</Overline>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterChips}
      >
        {options.map((option) => (
          <Chip
            key={option.value}
            label={option.label}
            selected={value === option.value}
            onPress={() => onChange(value === option.value ? undefined : option.value)}
          />
        ))}
      </ScrollView>
    </View>
  );
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
  const { tones } = useTheme();
  const completed = tasks.filter((task) => task.completed && !task.canceled).length;
  const total = tasks.filter((task) => !task.canceled).length;
  const progress = total === 0 ? 0 : completed / total;
  const meta = [
    total > 0 ? t("projects.tasksProgress", { completed, total }) : null,
    project.targetDate
      ? t("projects.targetDate", {
          date: new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(
            new Date(`${project.targetDate}T12:00:00`),
          ),
        })
      : null,
    project.priority === "high" || project.priority === "critical"
      ? formatProjectPriority(locale, project.priority)
      : null,
  ].filter(Boolean);
  return (
    <Card
      accessibilityLabel={t("projects.openA11y", { title: project.title })}
      onPress={onOpen}
      onLongPress={onStatus}
    >
      <View style={styles.cardHead}>
        <StoneText variant="title3" numberOfLines={2} style={styles.cardTitle}>
          {project.title}
        </StoneText>
        <Badge
          label={formatProjectStatus(locale, project.status)}
          tone={statusTone[project.status]}
        />
      </View>
      {meta.length > 0 ? (
        <StoneText variant="caption" tone="muted" style={styles.cardMeta}>
          {meta.join(" · ")}
        </StoneText>
      ) : null}
      {total > 0 ? (
        <View style={styles.progressBlock}>
          <ProgressBar
            value={progress}
            accessibilityLabel={t("projects.tasksProgress", { completed, total })}
          />
        </View>
      ) : null}
      {project.nextAction ? (
        <View style={styles.nextAction}>
          <Ionicons name="arrow-forward" size={14} color={tones.accent.fg} />
          <StoneText
            variant="bodySmall"
            tone="secondary"
            numberOfLines={2}
            style={styles.cardTitle}
          >
            {project.nextAction}
          </StoneText>
        </View>
      ) : null}
      {project.health === "risk" || project.health === "attention" ? (
        <StoneText
          variant="caption"
          style={[
            styles.cardMeta,
            { color: project.health === "risk" ? tones.danger.fg : tones.warning.fg },
          ]}
        >
          {formatProjectHealth(locale, project.health)}
        </StoneText>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  filterPanel: { gap: spacing.md, paddingTop: spacing.md },
  filterChips: { gap: spacing.xs, paddingRight: spacing.lg },
  cardMeta: { marginTop: spacing.xs },
  nextAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  list: { gap: spacing.sm, paddingTop: spacing.md, paddingBottom: spacing.giant },
  emptyList: { flexGrow: 1 },
  cardHead: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  cardTitle: { flex: 1 },
  progressBlock: { marginTop: spacing.sm },
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
