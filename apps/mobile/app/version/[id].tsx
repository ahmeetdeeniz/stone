import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, View } from "react-native";
import type { ProjectTask, ProjectVersion, PlatformReleaseStatus } from "@stone/domain";
import { platformReleaseStatuses, projectStatuses } from "@stone/domain";
import { formatProjectStatus, formatReleaseStatus } from "@stone/i18n";
import { ErrorState, LoadingState } from "../../src/components/states";
import { ResponsiveContent } from "../../src/components/responsive";
import { Screen, StoneButton, StoneInput, StoneText, Surface } from "../../src/components/ui";
import { spacing } from "../../src/design/tokens";
import { useTheme } from "../../src/design/theme";
import { useAuth } from "../../src/providers/auth-provider";
import { useAppServices } from "../../src/providers/app-provider";
import { useI18n } from "../../src/i18n/provider";

export default function VersionDetailScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const { projectUseCases, deviceId } = useAppServices();
  const { locale, t } = useI18n();
  const { colors } = useTheme();
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
      if (!loaded) throw new Error(t("versions.notFound"));
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
      setError(caught instanceof Error ? caught.message : t("versions.loadFailed"));
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
      Alert.alert(t("versions.saved"), t("versions.savedDetail"));
    } catch (caught) {
      Alert.alert(
        t("versions.saveFailed"),
        caught instanceof Error ? caught.message : t("app.unknownError"),
      );
    }
  };

  if (loading)
    return (
      <Screen>
        <LoadingState label={t("versions.preparing")} />
      </Screen>
    );
  if (error || !version)
    return (
      <Screen>
        <ErrorState message={error ?? t("versions.notFound")} onRetry={() => void load()} />
      </Screen>
    );

  return (
    <Screen>
      <ResponsiveContent>
        <ScrollView contentContainerStyle={styles.content}>
          <StoneButton label={t("common.back")} variant="quiet" onPress={() => router.back()} />
          <StoneText variant="title1">v{version.version}</StoneText>
          <StoneText variant="bodySmall">
            {t("versions.tasksProgress", {
              completed: version.completedTasks,
              total: version.totalTasks,
            })}
          </StoneText>
          <Surface>
            <StoneText variant="title3">{t("versions.frontmatter")}</StoneText>
            <StoneText variant="label">{t("versions.status")}</StoneText>
            <View style={styles.choices}>
              {projectStatuses.map((option) => (
                <StoneButton
                  key={option}
                  label={formatProjectStatus(locale, option)}
                  variant={status === option ? "primary" : "secondary"}
                  onPress={() => setStatus(option)}
                />
              ))}
            </View>
            <StoneInput
              label={t("projects.targetDateField")}
              value={targetDate}
              onChangeText={setTargetDate}
            />
            <PlatformStatus
              label={t("versions.androidStatus")}
              value={androidStatus}
              onChange={setAndroidStatus}
            />
            <PlatformStatus
              label={t("versions.iosStatus")}
              value={iosStatus}
              onChange={setIosStatus}
            />
            <StoneButton label={t("versions.save")} onPress={() => void save()} />
          </Surface>
          <Surface>
            <StoneText variant="title3">{t("versions.tasks")}</StoneText>
            {tasks.length === 0 ? (
              <StoneText variant="bodySmall">{t("projects.noTasks")}</StoneText>
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
                          t("projects.taskUpdateFailed"),
                          caught instanceof Error ? caught.message : t("app.unknownError"),
                        ),
                      )
                  }
                  style={[styles.task, { borderBottomColor: colors.border }]}
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
  const { locale } = useI18n();
  return (
    <View style={styles.platform}>
      <StoneText variant="label">{label}</StoneText>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.choices}
      >
        {platformReleaseStatuses.map((status) => (
          <StoneButton
            key={status}
            label={formatReleaseStatus(locale, status)}
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
  },
});
