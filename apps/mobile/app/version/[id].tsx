import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, View } from "react-native";
import type { ProjectTask, ProjectVersion, PlatformReleaseStatus } from "@stone/domain";
import { projectStatuses, projectStatusLabels } from "@stone/domain";
import { ErrorState, LoadingState } from "../../src/components/states";
import { ResponsiveContent } from "../../src/components/responsive";
import { Screen, StoneButton, StoneInput, StoneText, Surface } from "../../src/components/ui";
import { spacing } from "../../src/design/tokens";
import { useAuth } from "../../src/providers/auth-provider";
import { useAppServices } from "../../src/providers/app-provider";

const releaseStatuses: readonly PlatformReleaseStatus[] = [
  "not_planned",
  "preparing",
  "internal_testing",
  "external_testing",
  "review",
  "live",
  "paused",
  "rejected",
];

export default function VersionDetailScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const { projectUseCases, deviceId } = useAppServices();
  const [version, setVersion] = useState<ProjectVersion | null>(null);
  const [tasks, setTasks] = useState<readonly ProjectTask[]>([]);
  const [targetDate, setTargetDate] = useState("");
  const [status, setStatus] = useState<ProjectVersion["status"]>("development");
  const [androidStatus, setAndroidStatus] = useState<PlatformReleaseStatus>("not_planned");
  const [iosStatus, setIosStatus] = useState<PlatformReleaseStatus>("not_planned");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user || !id) return;
    setLoading(true);
    try {
      const loaded = await projectUseCases.getVersion(user.uid, id);
      if (!loaded) throw new Error("Sürüm bulunamadı.");
      setVersion(loaded);
      setTasks(
        (await projectUseCases.tasks(user.uid, loaded.projectId)).filter(
          (task) => task.versionId === loaded.id,
        ),
      );
      setTargetDate(loaded.targetDate ?? "");
      setStatus(loaded.status);
      setAndroidStatus(loaded.androidStatus);
      setIosStatus(loaded.iosStatus);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Sürüm yüklenemedi.");
    } finally {
      setLoading(false);
    }
  }, [id, projectUseCases, user]);

  useEffect(() => void load(), [load]);

  const save = async () => {
    if (!user || !version) return;
    try {
      const updated = await projectUseCases.updateVersion(
        user.uid,
        version.id,
        { status, targetDate: targetDate.trim() || null, androidStatus, iosStatus },
        deviceId,
      );
      setVersion(updated);
      Alert.alert("Sürüm kaydedildi", "Version.md frontmatter güncellendi.");
    } catch (caught) {
      Alert.alert(
        "Sürüm kaydedilemedi",
        caught instanceof Error ? caught.message : "Tekrar deneyin.",
      );
    }
  };

  if (loading)
    return (
      <Screen>
        <LoadingState label="Sürüm hazırlanıyor" />
      </Screen>
    );
  if (error || !version)
    return (
      <Screen>
        <ErrorState message={error ?? "Sürüm bulunamadı."} onRetry={() => void load()} />
      </Screen>
    );

  return (
    <Screen>
      <ResponsiveContent>
        <ScrollView contentContainerStyle={styles.content}>
          <StoneButton label="Geri" variant="quiet" onPress={() => router.back()} />
          <StoneText variant="title1">v{version.version}</StoneText>
          <StoneText variant="bodySmall">
            {version.completedTasks}/{version.totalTasks} görev tamamlandı
          </StoneText>
          <Surface>
            <StoneText variant="title3">Version.md frontmatter</StoneText>
            <StoneText variant="label">Sürüm durumu</StoneText>
            <View style={styles.choices}>
              {projectStatuses.map((option) => (
                <StoneButton
                  key={option}
                  label={projectStatusLabels[option]}
                  variant={status === option ? "primary" : "secondary"}
                  onPress={() => setStatus(option)}
                />
              ))}
            </View>
            <StoneInput
              label="Hedef tarih (YYYY-MM-DD)"
              value={targetDate}
              onChangeText={setTargetDate}
            />
            <PlatformStatus
              label="Android release durumu"
              value={androidStatus}
              onChange={setAndroidStatus}
            />
            <PlatformStatus label="iOS release durumu" value={iosStatus} onChange={setIosStatus} />
            <StoneButton label="Sürümü kaydet" onPress={() => void save()} />
          </Surface>
          <Surface>
            <StoneText variant="title3">Sürüm görevleri</StoneText>
            {tasks.length === 0 ? (
              <StoneText variant="bodySmall">Henüz görev yok.</StoneText>
            ) : (
              tasks.map((task) => (
                <Pressable
                  key={task.id}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: task.completed }}
                  onPress={() =>
                    void projectUseCases
                      .toggleTask(user!.uid, task.id, !task.completed, deviceId)
                      .then(load)
                      .catch((caught: unknown) =>
                        Alert.alert(
                          "Görev güncellenemedi",
                          caught instanceof Error ? caught.message : "Tekrar deneyin.",
                        ),
                      )
                  }
                  style={styles.task}
                >
                  <StoneText variant="body">
                    {task.completed ? "☑" : "☐"} {task.text}
                  </StoneText>
                </Pressable>
              ))
            )}
          </Surface>
        </ScrollView>
      </ResponsiveContent>
    </Screen>
  );
}

function PlatformStatus({
  label,
  value,
  onChange,
}: {
  label: string;
  value: PlatformReleaseStatus;
  onChange: (value: PlatformReleaseStatus) => void;
}) {
  return (
    <View style={styles.platform}>
      <StoneText variant="label">{label}</StoneText>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.choices}
      >
        {releaseStatuses.map((status) => (
          <StoneButton
            key={status}
            label={status}
            variant={value === status ? "primary" : "secondary"}
            onPress={() => onChange(status)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.lg, paddingBottom: spacing.giant },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  platform: { gap: spacing.sm },
  task: {
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#D6D2DD",
  },
});
