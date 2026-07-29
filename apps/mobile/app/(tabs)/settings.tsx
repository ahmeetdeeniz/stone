import { useCallback, useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { Alert, StyleSheet, View } from "react-native";
import { ResponsiveContent } from "../../src/components/responsive";
import { Screen, StoneButton, StoneText } from "../../src/components/ui";
import { spacing } from "../../src/design/tokens";
import { useTheme } from "../../src/design/theme";
import { useAuth } from "../../src/providers/auth-provider";
import { useAppServices } from "../../src/providers/app-provider";
import { pickWorkspaceCalendarFile, shareWorkspaceExport } from "../../src/notes/workspace-files";
import { restoreCalendarWorkspaceFile } from "../../src/notes/workspace-bundle";
import type { SyncState } from "../../src/infrastructure/storage/sync";
import { useI18n } from "../../src/i18n/provider";

export default function SettingsScreen() {
  const router = useRouter();
  const { preference, setPreference, colors } = useTheme();
  const { preference: localePreference, setPreference: setLocalePreference, t } = useI18n();
  const { user, service } = useAuth();
  const services = useAppServices();
  const [busy, setBusy] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [syncState, setSyncState] = useState<SyncState | null>(null);
  useEffect(() => {
    if (!user) return;
    setSettingsLoaded(false);
    void services.settingsUseCases
      .load(user.uid)
      .then((stored) => {
        setPreference(stored.theme);
        setSettingsLoaded(true);
      })
      .catch((error: unknown) => {
        setSettingsLoaded(true);
        Alert.alert(
          t("settings.themeLoadFailed"),
          error instanceof Error ? error.message : t("settings.localReadFailed"),
        );
      });
  }, [services.settingsUseCases, setPreference, user]);
  const loadSyncState = useCallback(async () => {
    if (!user) return;
    setSyncState(await services.syncStore.getState(user.uid));
  }, [services.syncStore, user]);
  useEffect(() => {
    void loadSyncState();
  }, [loadSyncState]);
  const updateTheme = async (option: "system" | "light" | "dark") => {
    setPreference(option);
    if (!user || !settingsLoaded) return;
    try {
      await services.settingsUseCases.setTheme(user.uid, option);
    } catch (error) {
      Alert.alert(
        t("settings.themeSaveFailed"),
        error instanceof Error ? error.message : t("settings.localSaveFailed"),
      );
    }
  };
  const runSync = async () => {
    if (!user) return;
    setBusy(true);
    try {
      await services.sync(user.uid);
      await loadSyncState();
    } catch (error) {
      Alert.alert(
        t("settings.syncFailed"),
        error instanceof Error ? error.message : t("app.unknownError"),
      );
    } finally {
      setBusy(false);
    }
  };
  const signOut = async () => {
    if (!service) return;
    setBusy(true);
    try {
      await service.signOut();
    } catch (error) {
      Alert.alert(
        t("settings.signOutFailed"),
        error instanceof Error ? error.message : t("app.unknownError"),
      );
    } finally {
      setBusy(false);
    }
  };
  const exportAll = async () => {
    if (!user) return;
    setBusy(true);
    try {
      await shareWorkspaceExport(await services.exportWorkspace(user.uid));
    } catch (error) {
      Alert.alert(
        t("settings.exportFailed"),
        error instanceof Error ? error.message : t("app.unknownError"),
      );
    } finally {
      setBusy(false);
    }
  };
  const restoreCalendar = async () => {
    if (!user) return;
    setBusy(true);
    try {
      const source = await pickWorkspaceCalendarFile();
      if (source === null) return;
      const [tasks, projects, documents] = await Promise.all([
        services.taskUseCases.list(user.uid),
        services.projectUseCases.list(user.uid),
        services.noteUseCases.list(user.uid),
      ]);
      const summary = await restoreCalendarWorkspaceFile(source, user.uid, services.calendar, {
        taskIds: new Set(tasks.map((task) => task.id)),
        projectIds: new Set(projects.map((project) => project.id)),
        documentIds: new Set(documents.map((document) => document.id)),
      });
      Alert.alert(
        t("settings.calendarRestored"),
        t("settings.restoreSummary", {
          created: summary.created,
          duplicates: summary.duplicates,
          detached: summary.detachedRelationships,
        }),
      );
    } catch (error) {
      Alert.alert(
        t("settings.restoreFailed"),
        error instanceof Error ? error.message : t("app.unknownError"),
      );
    } finally {
      setBusy(false);
    }
  };
  const deleteAccount = () => {
    if (!user || !service) return;
    Alert.alert(t("settings.deleteAccountConfirm"), t("settings.deleteAccountDetail"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("settings.deletePermanently"),
        style: "destructive",
        onPress: () => {
          void (async () => {
            setBusy(true);
            try {
              await services.deleteRemoteData(user.uid);
              await service.deleteAccount();
              await services.purgeLocalData(user.uid);
            } catch (error) {
              Alert.alert(
                t("settings.deleteAccountFailed"),
                error instanceof Error ? error.message : t("app.unknownError"),
              );
            } finally {
              setBusy(false);
            }
          })();
        },
      },
    ]);
  };
  return (
    <Screen>
      <ResponsiveContent>
        <StoneText variant="title1" style={styles.title}>
          {t("tabs.settings")}
        </StoneText>
        <View style={[styles.section, { borderColor: colors.border }]}>
          <StoneText variant="title3">{t("locale.setting")}</StoneText>
          <StoneText variant="bodySmall" style={{ color: colors.textSecondary }}>
            {t("locale.description")} {t("locale.persistence")}
          </StoneText>
          <View style={styles.options}>
            {(["system", "en", "tr"] as const).map((option) => (
              <StoneButton
                key={option}
                label={
                  option === "system"
                    ? t("locale.system")
                    : option === "en"
                      ? t("locale.english")
                      : t("locale.turkish")
                }
                variant={localePreference === option ? "primary" : "secondary"}
                onPress={() => void setLocalePreference(option)}
                accessibilityLabel={`${t("locale.setting")}: ${
                  option === "system"
                    ? t("locale.system")
                    : option === "en"
                      ? t("locale.english")
                      : t("locale.turkish")
                }`}
              />
            ))}
          </View>
        </View>
        <View style={[styles.section, { borderColor: colors.border }]}>
          <StoneText variant="title3">{t("settings.sync")}</StoneText>
          <StoneText variant="bodySmall" style={{ color: colors.textSecondary }}>
            {t("settings.status", { status: syncState?.status ?? "saved" })}
            {syncState?.lastError ? ` · ${syncState.lastError}` : ""}
          </StoneText>
          <View style={styles.options}>
            <StoneButton
              label={t("settings.syncNow")}
              variant="secondary"
              onPress={() => void runSync()}
              disabled={busy || !user}
            />
            <StoneButton
              label={t("settings.conflicts")}
              variant="quiet"
              onPress={() => router.push("/conflicts")}
            />
          </View>
        </View>
        <View style={[styles.section, { borderColor: colors.border }]}>
          <StoneText variant="title3">{t("settings.theme")}</StoneText>
          <StoneText variant="bodySmall" style={{ color: colors.textSecondary }}>
            {t("settings.themePersistence")}
          </StoneText>
          <View style={styles.options}>
            {(["system", "light", "dark"] as const).map((option) => (
              <StoneButton
                key={option}
                label={
                  option === "system"
                    ? t("settings.theme.system")
                    : option === "light"
                      ? t("settings.theme.light")
                      : t("settings.theme.dark")
                }
                variant={preference === option ? "primary" : "secondary"}
                onPress={() => void updateTheme(option)}
              />
            ))}
          </View>
        </View>
        <View style={[styles.section, { borderColor: colors.border }]}>
          <StoneText variant="title3">{t("settings.account")}</StoneText>
          <StoneText variant="bodySmall" style={{ color: colors.textSecondary }}>
            {user?.email ?? t("settings.noSession")}
          </StoneText>
          <StoneButton
            label={busy ? t("settings.signingOut") : t("settings.signOut")}
            variant="secondary"
            onPress={() => void signOut()}
            disabled={busy}
          />
          <StoneButton
            label={t("settings.exportWorkspace")}
            variant="quiet"
            onPress={() => void exportAll()}
            disabled={busy || !user}
          />
          <StoneButton
            label={t("settings.restoreCalendar")}
            variant="quiet"
            onPress={() => void restoreCalendar()}
            disabled={busy || !user}
          />
          <StoneButton
            label={t("settings.deleteAccount")}
            variant="quiet"
            onPress={deleteAccount}
            disabled={busy || !user}
          />
        </View>
        <View style={[styles.section, { borderColor: colors.border }]}>
          <StoneText variant="title3">{t("settings.noteManagement")}</StoneText>
          <StoneButton
            label={t("settings.openTrash")}
            variant="secondary"
            onPress={() => router.push("/trash")}
          />
        </View>
      </ResponsiveContent>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { marginBottom: spacing.xxl },
  section: {
    borderWidth: 1,
    borderRadius: 16,
    padding: spacing.lg,
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  options: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
});
