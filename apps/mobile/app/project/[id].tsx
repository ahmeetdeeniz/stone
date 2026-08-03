import * as Crypto from "expo-crypto";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, View } from "react-native";
import type {
  Project,
  ProjectBlocker,
  ProjectDecision,
  ProjectTask,
  ProjectVersion,
  Task,
  CalendarItem,
} from "@stone/domain";
import { projectPriorities, projectStatuses } from "@stone/domain";
import {
  formatProjectPlatform,
  formatProjectHealth,
  formatProjectPriority,
  formatProjectStatus,
  formatReleaseStatus,
  formatTaskPriority,
  formatTaskState,
} from "@stone/i18n";
import { ErrorState, LoadingState } from "../../src/components/states";
import { ResponsiveContent } from "../../src/components/responsive";
import { Screen, StoneButton, StoneInput, StoneText, Surface } from "../../src/components/ui";
import { radii, spacing } from "../../src/design/tokens";
import { useTheme } from "../../src/design/theme";
import { useAuth } from "../../src/providers/auth-provider";
import { useAppServices } from "../../src/providers/app-provider";
import { shareProjectExport } from "../../src/projects/project-files";
import { createNewVersion } from "../../src/projects/factory";
import { useI18n } from "../../src/i18n/provider";

const platforms = ["android", "ios", "windows", "web", "other"] as const;

export default function ProjectDetailScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const { projectUseCases, taskUseCases, calendar, deviceId } = useAppServices();
  const { locale, t } = useI18n();
  const { colors } = useTheme();
  const [project, setProject] = useState<Project | null>(null);
  const [versions, setVersions] = useState<readonly ProjectVersion[]>([]);
  const [tasks, setTasks] = useState<readonly ProjectTask[]>([]);
  const [planningTasks, setPlanningTasks] = useState<readonly Task[]>([]);
  const [calendarItems, setCalendarItems] = useState<readonly CalendarItem[]>([]);
  const [blockers, setBlockers] = useState<readonly ProjectBlocker[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState<Project["status"]>("planning");
  const [priority, setPriority] = useState<Project["priority"]>("medium");
  const [tags, setTags] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [currentVersion, setCurrentVersion] = useState("");
  const [nextVersion, setNextVersion] = useState("");
  const [nextAction, setNextAction] = useState("");
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [selectedPlatforms, setSelectedPlatforms] = useState<Project["platforms"]>([]);
  const [blockerText, setBlockerText] = useState("");
  const [versionText, setVersionText] = useState("");
  const [decisionTitle, setDecisionTitle] = useState("");
  const [decisionText, setDecisionText] = useState("");

  const load = useCallback(async () => {
    if (!user || !id) return;
    setLoading(true);
    try {
      setError(null);
      const loaded = await projectUseCases.get(user.uid, id);
      if (!loaded) throw new Error(t("projects.notFound"));
      const today = new Date().toISOString().slice(0, 10);
      const horizon = new Date(`${today}T00:00:00Z`);
      horizon.setUTCDate(horizon.getUTCDate() + 90);
      const [loadedVersions, loadedTasks, loadedPlanningTasks, loadedBlockers, loadedCalendar] =
        await Promise.all([
          projectUseCases.versions(user.uid, id),
          projectUseCases.tasks(user.uid, id),
          taskUseCases.list(user.uid, { projectId: id }),
          projectUseCases.blockers(user.uid, id),
          calendar.list(user.uid, {
            startDate: today,
            endDate: horizon.toISOString().slice(0, 10),
            projectId: id,
          }),
        ]);
      setProject(loaded);
      setVersions(loadedVersions);
      setTasks(loadedTasks);
      setPlanningTasks(loadedPlanningTasks);
      setBlockers(loadedBlockers);
      setCalendarItems(loadedCalendar);
      setTitle(loaded.title);
      setStatus(loaded.status);
      setPriority(loaded.priority);
      setTags(loaded.tags.join(", "));
      setTargetDate(loaded.targetDate ?? "");
      setCurrentVersion(loaded.currentVersion ?? "");
      setNextVersion(loaded.nextVersion ?? "");
      setNextAction(loaded.nextAction ?? "");
      setRepositoryUrl(loaded.repositoryUrl ?? "");
      setSelectedPlatforms(loaded.platforms);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("projects.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [calendar, id, projectUseCases, taskUseCases, user]);

  useEffect(() => void load(), [load]);

  const save = async () => {
    if (!user || !project) return;
    setSaving(true);
    try {
      const updated = await projectUseCases.update(
        user.uid,
        project.id,
        {
          title,
          status,
          priority,
          tags: tags
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean),
          targetDate: targetDate.trim() || null,
          currentVersion: currentVersion.trim() || null,
          nextVersion: nextVersion.trim() || null,
          nextAction: nextAction.trim() || null,
          repositoryUrl: repositoryUrl.trim() || null,
          platforms: selectedPlatforms,
        },
        deviceId,
      );
      setProject(updated);
      Alert.alert(t("projects.saved"), t("projects.savedDetail"));
    } catch (caught) {
      Alert.alert(
        t("projects.saveFailed"),
        caught instanceof Error ? caught.message : t("app.unknownError"),
      );
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = (next: Project["status"]) => {
    if (!user) return;
    setStatus(next);
    if (project)
      void projectUseCases
        .update(user.uid, project.id, { status: next }, deviceId)
        .then(setProject)
        .catch((caught: unknown) =>
          Alert.alert(
            t("projects.statusUpdateFailed"),
            caught instanceof Error ? caught.message : t("app.unknownError"),
          ),
        );
  };

  const toggleTask = async (task: ProjectTask) => {
    if (!user) return;
    try {
      await projectUseCases.toggleTask(user.uid, task.id, !task.completed, deviceId);
      await load();
    } catch (caught) {
      Alert.alert(
        t("projects.taskUpdateFailed"),
        caught instanceof Error ? caught.message : t("app.unknownError"),
      );
    }
  };

  const addBlocker = async () => {
    if (!user || !project || !blockerText.trim()) return;
    const blocker: ProjectBlocker = {
      id: Crypto.randomUUID(),
      projectId: project.id,
      taskId: null,
      text: blockerText.trim(),
      resolved: false,
      createdAt: new Date().toISOString(),
      resolvedAt: null,
    };
    try {
      await projectUseCases.addBlocker(user.uid, blocker, deviceId);
      setBlockerText("");
      await load();
    } catch (caught) {
      Alert.alert(
        t("projects.blockerAddFailed"),
        caught instanceof Error ? caught.message : t("app.unknownError"),
      );
    }
  };

  const createVersion = async () => {
    if (!project || !versionText.trim()) return;
    try {
      await projectUseCases.createVersion(createNewVersion(project, versionText.trim(), deviceId));
      setVersionText("");
      await load();
    } catch (caught) {
      Alert.alert(
        t("projects.versionCreateFailed"),
        caught instanceof Error ? caught.message : t("app.unknownError"),
      );
    }
  };

  const addDecision = async () => {
    if (!user || !project || !decisionTitle.trim() || !decisionText.trim()) return;
    const decision: ProjectDecision = {
      id: Crypto.randomUUID(),
      projectId: project.id,
      title: decisionTitle.trim(),
      date: new Date().toISOString().slice(0, 10),
      decision: decisionText.trim(),
      reason: "",
      alternatives: "",
      outcome: "",
    };
    try {
      await projectUseCases.addDecision(user.uid, decision, deviceId);
      setDecisionTitle("");
      setDecisionText("");
      Alert.alert(t("projects.decisionSaved"), t("projects.decisionSavedDetail"));
    } catch (caught) {
      Alert.alert(
        t("projects.decisionSaveFailed"),
        caught instanceof Error ? caught.message : t("app.unknownError"),
      );
    }
  };

  const exportProject = async () => {
    if (!user || !project) return;
    try {
      await shareProjectExport(
        project.slug,
        await projectUseCases.exportProject(user.uid, project.id),
      );
    } catch (caught) {
      Alert.alert(
        t("projects.exportFailed"),
        caught instanceof Error ? caught.message : t("projects.shareFailed"),
      );
    }
  };

  const createProjectEvent = async () => {
    if (!user || !project) return;
    const date = project.targetDate ?? new Date().toISOString().slice(0, 10);
    const now = new Date().toISOString();
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    try {
      const item = await calendar.create({
        schemaVersion: 1,
        id: Crypto.randomUUID(),
        ownerId: user.uid,
        revision: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        updatedByDeviceId: deviceId,
        kind: "event",
        title: t("projects.defaultEventTitle", { project: project.title }),
        description: null,
        allDay: true,
        startDate: date,
        endDate: date,
        startAt: null,
        endAt: null,
        timezone,
        location: null,
        category: "purple",
        projectId: project.id,
        sourceDocumentId: project.canonicalDocumentId,
        taskId: null,
        planningNote: null,
        recurrence: null,
        recurrenceSeriesId: null,
        recurrenceId: null,
        overrides: [],
        externalUid: null,
        cancelledAt: null,
      });
      router.push({ pathname: "/calendar/[id]", params: { id: item.id } });
    } catch (caught) {
      Alert.alert(t("projects.eventCreateFailed"), message(caught, t("app.unknownError")));
    }
  };

  if (loading)
    return (
      <Screen>
        <LoadingState label={t("projects.preparing")} />
      </Screen>
    );
  if (error || !project)
    return (
      <Screen>
        <ErrorState message={error ?? t("projects.notFound")} onRetry={() => void load()} />
      </Screen>
    );

  return (
    <Screen>
      <ResponsiveContent>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.topbar}>
            <StoneButton label={t("common.back")} variant="quiet" onPress={() => router.back()} />
            <StoneButton
              label={t("focus.startLinked")}
              variant="secondary"
              onPress={() =>
                router.push({
                  pathname: "/(tabs)/focus",
                  params: { projectId: project.id },
                })
              }
            />
            <StoneButton
              label={t("projects.exportMarkdown")}
              variant="secondary"
              onPress={() => void exportProject()}
            />
          </View>
          <StoneText variant="display">{project.title}</StoneText>
          <StoneText variant="bodySmall">
            {project.slug} ·{" "}
            {t("projects.health", { health: formatProjectHealth(locale, project.health) })}
          </StoneText>
          <Surface>
            <StoneText variant="title3">{t("projects.healthExplanation")}</StoneText>
            <StoneText variant="bodySmall">{healthExplanation(project, t)}</StoneText>
          </Surface>

          <Section title="Project.md frontmatter">
            <StoneInput label={t("tasks.titleField")} value={title} onChangeText={setTitle} />
            <StoneText variant="label">{t("projects.statusTitle")}</StoneText>
            <View style={styles.choices}>
              {projectStatuses.map((option) => (
                <StoneButton
                  key={option}
                  label={formatProjectStatus(locale, option)}
                  variant={status === option ? "primary" : "secondary"}
                  onPress={() => changeStatus(option)}
                />
              ))}
            </View>
            <StoneText variant="label">{t("projects.priority")}</StoneText>
            <View style={styles.choices}>
              {projectPriorities.map((option) => (
                <StoneButton
                  key={option}
                  label={formatProjectPriority(locale, option)}
                  variant={priority === option ? "primary" : "secondary"}
                  onPress={() => setPriority(option)}
                />
              ))}
            </View>
            <StoneInput
              label={t("projects.tagsField")}
              value={tags}
              onChangeText={setTags}
              placeholder={t("projects.tagsPlaceholder")}
            />
            <StoneInput
              label={t("projects.targetDateField")}
              value={targetDate}
              onChangeText={setTargetDate}
              placeholder="2026-09-30"
            />
            <StoneInput
              label={t("projects.currentVersion")}
              value={currentVersion}
              onChangeText={setCurrentVersion}
            />
            <StoneInput
              label={t("projects.nextVersion")}
              value={nextVersion}
              onChangeText={setNextVersion}
            />
            <StoneInput
              label={t("projects.nextAction")}
              value={nextAction}
              onChangeText={setNextAction}
            />
            <StoneInput
              label={t("projects.repositoryUrl")}
              value={repositoryUrl}
              onChangeText={setRepositoryUrl}
              autoCapitalize="none"
            />
            <StoneText variant="label">{t("projects.platforms")}</StoneText>
            <View style={styles.choices}>
              {platforms.map((option) => (
                <StoneButton
                  key={option}
                  label={formatProjectPlatform(locale, option)}
                  variant={selectedPlatforms.includes(option) ? "primary" : "secondary"}
                  onPress={() =>
                    setSelectedPlatforms((current) =>
                      current.includes(option)
                        ? current.filter((item) => item !== option)
                        : [...current, option],
                    )
                  }
                />
              ))}
            </View>
            <StoneButton
              label={saving ? t("projects.saving") : t("projects.saveFrontmatter")}
              onPress={() => void save()}
              disabled={saving}
            />
          </Section>

          <Section
            title={t("projects.markdownTasksProgress", {
              completed: tasks.filter((task) => !task.canceled && task.completed).length,
              total: tasks.filter((task) => !task.canceled).length,
            })}
          >
            {tasks.length === 0 ? (
              <StoneText variant="bodySmall">{t("projects.noTasks")}</StoneText>
            ) : (
              tasks.map((task) => (
                <Pressable
                  key={task.id}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: task.completed }}
                  onPress={() => void toggleTask(task)}
                  style={[styles.task, { borderBottomColor: colors.border }]}
                >
                  <StoneText variant="body">
                    {task.completed ? "☑" : "☐"} {task.text}
                  </StoneText>
                  <StoneText variant="caption">
                    {task.priority
                      ? t("projects.taskPriority", {
                          priority: formatProjectPriority(locale, task.priority),
                        })
                      : ""}
                    {task.dueDate ? ` · ${task.dueDate}` : ""}
                    {task.blocked ? ` · ${t("tasks.blocker")}` : ""}
                  </StoneText>
                </Pressable>
              ))
            )}
          </Section>

          <Section
            title={t("projects.planningTasks", {
              completed: planningTasks.filter((task) => task.state === "completed").length,
              total: planningTasks.length,
            })}
          >
            {planningTasks.length === 0 ? (
              <StoneText variant="bodySmall">{t("projects.noPlanningTasks")}</StoneText>
            ) : (
              planningTasks.map((task) => (
                <Pressable
                  key={task.id}
                  accessibilityRole="button"
                  accessibilityLabel={t("tasks.editA11y", { title: task.title })}
                  onPress={() => router.push({ pathname: "/task/[id]", params: { id: task.id } })}
                  style={[styles.task, { borderBottomColor: colors.border }]}
                >
                  <StoneText variant="body">
                    {task.state === "completed" ? "☑" : "☐"} {task.title}
                  </StoneText>
                  <StoneText variant="caption">
                    {formatTaskState(locale, task.state)}
                    {task.priority !== "none"
                      ? ` · ${t("projects.taskPriority", {
                          priority: formatTaskPriority(locale, task.priority),
                        })}`
                      : ""}
                    {task.dueDate ? ` · ${task.dueDate}` : ""}
                    {task.sourceDocumentId ? ` · ${t("calendar.sourceNote")}` : ""}
                  </StoneText>
                </Pressable>
              ))
            )}
          </Section>

          <Section title={`${t("projects.calendar")} (${calendarItems.length})`}>
            <StoneText variant="bodySmall">
              {t("calendar.projectTargetDate")} · {t("tasks.blockDistinct")}
            </StoneText>
            <StoneButton
              label={t("projects.createEvent")}
              variant="secondary"
              onPress={() => void createProjectEvent()}
            />
            {project.targetDate ? (
              <StoneText variant="caption">
                {t("projects.metadataTarget", { date: project.targetDate })}
              </StoneText>
            ) : null}
            {calendarItems.map((item) => (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={`${item.title} · ${t("common.open")}`}
                onPress={() => router.push({ pathname: "/calendar/[id]", params: { id: item.id } })}
                style={[styles.task, { borderBottomColor: colors.border }]}
              >
                <StoneText>{item.title}</StoneText>
                <StoneText variant="caption">
                  {item.kind === "task_block" ? t("calendar.taskBlock") : t("calendar.event")} ·{" "}
                  {item.startDate}
                </StoneText>
              </Pressable>
            ))}
          </Section>

          <Section title={t("tasks.blocker")}>
            <StoneInput
              label={t("projects.newBlocker")}
              value={blockerText}
              onChangeText={setBlockerText}
              placeholder={t("projects.blockerPlaceholder")}
            />
            <StoneButton
              label={t("projects.addBlocker")}
              variant="secondary"
              onPress={() => void addBlocker()}
              disabled={!blockerText.trim()}
            />
            {blockers.map((blocker) => (
              <Surface key={blocker.id}>
                <StoneText variant="body">
                  {blocker.resolved ? "☑" : "☐"} {blocker.text}
                </StoneText>
                {!blocker.resolved ? (
                  <StoneButton
                    label={t("projects.resolved")}
                    variant="quiet"
                    onPress={() => {
                      if (!user) return;
                      void projectUseCases
                        .resolveBlocker(user.uid, blocker.id, new Date().toISOString(), deviceId)
                        .then(load)
                        .catch((caught: unknown) =>
                          Alert.alert(
                            t("projects.blockerUpdateFailed"),
                            caught instanceof Error ? caught.message : t("app.unknownError"),
                          ),
                        );
                    }}
                  />
                ) : null}
              </Surface>
            ))}
          </Section>

          <Section title={t("projects.versions")}>
            <StoneInput
              label={t("projects.newVersion")}
              value={versionText}
              onChangeText={setVersionText}
              placeholder="1.0.0"
              autoCapitalize="none"
            />
            <StoneButton
              label={t("projects.createVersion")}
              variant="secondary"
              onPress={() => void createVersion()}
              disabled={!versionText.trim()}
            />
            {versions.map((version) => (
              <Pressable
                key={version.id}
                accessibilityRole="button"
                accessibilityLabel={t("projects.openVersionA11y", {
                  version: version.version,
                })}
                onPress={() =>
                  router.push({ pathname: "/version/[id]", params: { id: version.id } })
                }
                style={[styles.version, { borderColor: colors.border }]}
              >
                <StoneText variant="title3">v{version.version}</StoneText>
                <StoneText variant="bodySmall">
                  {formatProjectStatus(locale, version.status)} · {version.completedTasks}/
                  {version.totalTasks} · Android:{" "}
                  {formatReleaseStatus(locale, version.androidStatus)} · iOS:{" "}
                  {formatReleaseStatus(locale, version.iosStatus)}
                </StoneText>
              </Pressable>
            ))}
          </Section>

          <Section title={t("projects.decisionLog")}>
            <StoneInput
              label={t("projects.decisionTitle")}
              value={decisionTitle}
              onChangeText={setDecisionTitle}
            />
            <StoneInput
              label={t("projects.decision")}
              value={decisionText}
              onChangeText={setDecisionText}
              multiline
            />
            <StoneButton
              label={t("projects.saveDecision")}
              variant="secondary"
              onPress={() => void addDecision()}
              disabled={!decisionTitle.trim() || !decisionText.trim()}
            />
          </Section>
        </ScrollView>
      </ResponsiveContent>
    </Screen>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <StoneText variant="title2">{title}</StoneText>
      {children}
    </View>
  );
}

function healthExplanation(project: Project, t: ReturnType<typeof useI18n>["t"]): string {
  if (project.health === "paused") return t("projects.health.paused");
  if (project.health === "risk") return t("projects.health.risk");
  if (project.health === "attention") return t("projects.health.attention");
  return t("projects.health.healthy");
}

function message(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

const styles = StyleSheet.create({
  content: { gap: spacing.lg, paddingBottom: spacing.giant },
  topbar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  section: { gap: spacing.md },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  task: {
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  version: {
    gap: spacing.xs,
    padding: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
  },
});
