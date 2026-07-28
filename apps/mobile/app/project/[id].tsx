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
} from "@stone/domain";
import {
  projectPriorities,
  projectPriorityLabels,
  projectStatuses,
  projectStatusLabels,
} from "@stone/domain";
import { ErrorState, LoadingState } from "../../src/components/states";
import { ResponsiveContent } from "../../src/components/responsive";
import { Screen, StoneButton, StoneInput, StoneText, Surface } from "../../src/components/ui";
import { spacing } from "../../src/design/tokens";
import { useAuth } from "../../src/providers/auth-provider";
import { useAppServices } from "../../src/providers/app-provider";
import { shareProjectExport } from "../../src/projects/project-files";
import { createNewVersion } from "../../src/projects/factory";

const platforms = ["android", "ios", "windows", "web", "other"] as const;

export default function ProjectDetailScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const { projectUseCases, taskUseCases, deviceId } = useAppServices();
  const [project, setProject] = useState<Project | null>(null);
  const [versions, setVersions] = useState<readonly ProjectVersion[]>([]);
  const [tasks, setTasks] = useState<readonly ProjectTask[]>([]);
  const [planningTasks, setPlanningTasks] = useState<readonly Task[]>([]);
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
  const [selectedPlatforms, setSelectedPlatforms] = useState<readonly string[]>([]);
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
      if (!loaded) throw new Error("Proje bulunamadı.");
      const [loadedVersions, loadedTasks, loadedPlanningTasks, loadedBlockers] = await Promise.all([
        projectUseCases.versions(user.uid, id),
        projectUseCases.tasks(user.uid, id),
        taskUseCases.list(user.uid, { projectId: id }),
        projectUseCases.blockers(user.uid, id),
      ]);
      setProject(loaded);
      setVersions(loadedVersions);
      setTasks(loadedTasks);
      setPlanningTasks(loadedPlanningTasks);
      setBlockers(loadedBlockers);
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
      setError(caught instanceof Error ? caught.message : "Proje yüklenemedi.");
    } finally {
      setLoading(false);
    }
  }, [id, projectUseCases, taskUseCases, user]);

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
          platforms: selectedPlatforms as Project["platforms"],
        },
        deviceId,
      );
      setProject(updated);
      Alert.alert("Kaydedildi", "Project.md frontmatter ve yerel proje indeksi güncellendi.");
    } catch (caught) {
      Alert.alert(
        "Proje kaydedilemedi",
        caught instanceof Error ? caught.message : "Tekrar deneyin.",
      );
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = (next: Project["status"]) => {
    setStatus(next);
    if (project)
      void projectUseCases
        .update(user!.uid, project.id, { status: next }, deviceId)
        .then(setProject)
        .catch((caught: unknown) =>
          Alert.alert(
            "Durum güncellenemedi",
            caught instanceof Error ? caught.message : "Tekrar deneyin.",
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
        "Görev güncellenemedi",
        caught instanceof Error ? caught.message : "Tekrar deneyin.",
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
        "Blocker eklenemedi",
        caught instanceof Error ? caught.message : "Tekrar deneyin.",
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
        "Sürüm oluşturulamadı",
        caught instanceof Error ? caught.message : "Tekrar deneyin.",
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
      Alert.alert("Karar kaydedildi", "Decisions.md güncellendi.");
    } catch (caught) {
      Alert.alert(
        "Karar kaydedilemedi",
        caught instanceof Error ? caught.message : "Tekrar deneyin.",
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
        "Proje dışa aktarılamadı",
        caught instanceof Error ? caught.message : "Paylaşım başlatılamadı.",
      );
    }
  };

  if (loading)
    return (
      <Screen>
        <LoadingState label="Proje hazırlanıyor" />
      </Screen>
    );
  if (error || !project)
    return (
      <Screen>
        <ErrorState message={error ?? "Proje bulunamadı."} onRetry={() => void load()} />
      </Screen>
    );

  return (
    <Screen>
      <ResponsiveContent>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.topbar}>
            <StoneButton label="Geri" variant="quiet" onPress={() => router.back()} />
            <StoneButton
              label="Markdown dışa aktar"
              variant="secondary"
              onPress={() => void exportProject()}
            />
          </View>
          <StoneText variant="display">{project.title}</StoneText>
          <StoneText variant="bodySmall">
            {project.slug} · sağlık: {project.health}
          </StoneText>
          <Surface>
            <StoneText variant="title3">Sağlık açıklaması</StoneText>
            <StoneText variant="bodySmall">{healthExplanation(project)}</StoneText>
          </Surface>

          <Section title="Project.md frontmatter">
            <StoneInput label="Başlık" value={title} onChangeText={setTitle} />
            <StoneText variant="label">Durum</StoneText>
            <View style={styles.choices}>
              {projectStatuses.map((option) => (
                <StoneButton
                  key={option}
                  label={projectStatusLabels[option]}
                  variant={status === option ? "primary" : "secondary"}
                  onPress={() => changeStatus(option)}
                />
              ))}
            </View>
            <StoneText variant="label">Öncelik</StoneText>
            <View style={styles.choices}>
              {projectPriorities.map((option) => (
                <StoneButton
                  key={option}
                  label={projectPriorityLabels[option]}
                  variant={priority === option ? "primary" : "secondary"}
                  onPress={() => setPriority(option)}
                />
              ))}
            </View>
            <StoneInput
              label="Etiketler (virgülle ayırın)"
              value={tags}
              onChangeText={setTags}
              placeholder="mobil, oyun"
            />
            <StoneInput
              label="Hedef tarih (YYYY-MM-DD)"
              value={targetDate}
              onChangeText={setTargetDate}
              placeholder="2026-09-30"
            />
            <StoneInput
              label="Mevcut sürüm"
              value={currentVersion}
              onChangeText={setCurrentVersion}
            />
            <StoneInput label="Sonraki sürüm" value={nextVersion} onChangeText={setNextVersion} />
            <StoneInput label="Sonraki iş" value={nextAction} onChangeText={setNextAction} />
            <StoneInput
              label="Repository URL"
              value={repositoryUrl}
              onChangeText={setRepositoryUrl}
              autoCapitalize="none"
            />
            <StoneText variant="label">Platformlar</StoneText>
            <View style={styles.choices}>
              {platforms.map((option) => (
                <StoneButton
                  key={option}
                  label={option}
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
              label={saving ? "Kaydediliyor" : "Frontmatter'ı kaydet"}
              onPress={() => void save()}
              disabled={saving}
            />
          </Section>

          <Section
            title={`Görevler (${tasks.filter((task) => !task.canceled).filter((task) => task.completed).length}/${tasks.filter((task) => !task.canceled).length})`}
          >
            {tasks.length === 0 ? (
              <StoneText variant="bodySmall">Henüz görev yok.</StoneText>
            ) : (
              tasks.map((task) => (
                <Pressable
                  key={task.id}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: task.completed }}
                  onPress={() => void toggleTask(task)}
                  style={styles.task}
                >
                  <StoneText variant="body">
                    {task.completed ? "☑" : "☐"} {task.text}
                  </StoneText>
                  <StoneText variant="caption">
                    {task.priority ? `Öncelik: ${task.priority}` : ""}
                    {task.dueDate ? ` · ${task.dueDate}` : ""}
                    {task.blocked ? " · Blocker" : ""}
                  </StoneText>
                </Pressable>
              ))
            )}
          </Section>

          <Section
            title={`Planlama görevleri (${planningTasks.filter((task) => task.state === "completed").length}/${planningTasks.length})`}
          >
            {planningTasks.length === 0 ? (
              <StoneText variant="bodySmall">
                Bu projeye atanmış bağımsız veya not bağlantılı görev yok.
              </StoneText>
            ) : (
              planningTasks.map((task) => (
                <Pressable
                  key={task.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${task.title} görevini aç`}
                  onPress={() =>
                    router.push({ pathname: "/task/[id]" as never, params: { id: task.id } })
                  }
                  style={styles.task}
                >
                  <StoneText variant="body">
                    {task.state === "completed" ? "☑" : "☐"} {task.title}
                  </StoneText>
                  <StoneText variant="caption">
                    Durum: {task.state}
                    {task.priority !== "none" ? ` · Öncelik: ${task.priority}` : ""}
                    {task.dueDate ? ` · ${task.dueDate}` : ""}
                    {task.sourceDocumentId ? " · Kaynak not" : ""}
                  </StoneText>
                </Pressable>
              ))
            )}
          </Section>

          <Section title="Blocker'lar">
            <StoneInput
              label="Yeni blocker"
              value={blockerText}
              onChangeText={setBlockerText}
              placeholder="Neyi bekliyoruz?"
            />
            <StoneButton
              label="Blocker ekle"
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
                    label="Çözüldü"
                    variant="quiet"
                    onPress={() =>
                      void projectUseCases
                        .resolveBlocker(user!.uid, blocker.id, new Date().toISOString(), deviceId)
                        .then(load)
                        .catch((caught: unknown) =>
                          Alert.alert(
                            "Blocker güncellenemedi",
                            caught instanceof Error ? caught.message : "Tekrar deneyin.",
                          ),
                        )
                    }
                  />
                ) : null}
              </Surface>
            ))}
          </Section>

          <Section title="Sürümler">
            <StoneInput
              label="Yeni sürüm"
              value={versionText}
              onChangeText={setVersionText}
              placeholder="1.0.0"
              autoCapitalize="none"
            />
            <StoneButton
              label="Sürüm oluştur"
              variant="secondary"
              onPress={() => void createVersion()}
              disabled={!versionText.trim()}
            />
            {versions.map((version) => (
              <Pressable
                key={version.id}
                accessibilityRole="button"
                accessibilityLabel={`${version.version} sürümünü aç`}
                onPress={() =>
                  router.push({ pathname: "/version/[id]", params: { id: version.id } })
                }
                style={styles.version}
              >
                <StoneText variant="title3">v{version.version}</StoneText>
                <StoneText variant="bodySmall">
                  {projectStatusLabels[version.status]} · {version.completedTasks}/
                  {version.totalTasks} · Android: {version.androidStatus} · iOS: {version.iosStatus}
                </StoneText>
              </Pressable>
            ))}
          </Section>

          <Section title="Karar günlüğü">
            <StoneInput
              label="Karar başlığı"
              value={decisionTitle}
              onChangeText={setDecisionTitle}
            />
            <StoneInput
              label="Karar"
              value={decisionText}
              onChangeText={setDecisionText}
              multiline
            />
            <StoneButton
              label="Kararı kaydet"
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

function healthExplanation(project: Project): string {
  if (project.health === "paused") return "Proje beklemede veya arşivde.";
  if (project.health === "risk")
    return "Kritik blocker, gecikmiş hedef veya benzer risk sinyali var.";
  if (project.health === "attention")
    return "Yaklaşan hedef, eksik checklist veya uzun süredir güncellenmeme sinyali var.";
  return "Açık risk sinyali yok.";
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
    borderBottomColor: "#D6D2DD",
  },
  version: {
    gap: spacing.xs,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: "#D6D2DD",
    borderRadius: 12,
  },
});
