import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "expo-router";
import { Alert, PermissionsAndroid, Platform, ScrollView, StyleSheet, View } from "react-native";
import { ResponsiveContent } from "../../src/components/responsive";
import {
  Badge,
  Chip,
  Divider,
  Overline,
  Screen,
  ScreenHeader,
  SectionCard,
  StoneButton,
  StoneText,
} from "../../src/components/ui";
import { spacing } from "../../src/design/tokens";
import type { StatusTone } from "../../src/design/tokens";
import { useTheme } from "../../src/design/theme";
import { useAuth } from "../../src/providers/auth-provider";
import { useAppServices } from "../../src/providers/app-provider";
import { pickWorkspaceCalendarFile, shareWorkspaceExport } from "../../src/notes/workspace-files";
import { restoreCalendarWorkspaceFile } from "../../src/notes/workspace-bundle";
import type { SyncState } from "../../src/infrastructure/storage/sync";
import { useI18n } from "../../src/i18n/provider";
import type { WidgetPrivacy } from "@stone/widgets";
import { readWidgetPrivacy, writeWidgetPrivacy } from "../../src/widgets/widget-lifecycle";
import { refreshNativeWidgets } from "../../src/widgets/snapshot";
import { clearWidgetsForAccountLifecycle } from "../../src/widgets/snapshot";

const syncTone: Readonly<Record<string, StatusTone>> = {
  saved: "success",
  syncing: "info",
  offline: "warning",
  error: "danger",
  conflict: "danger",
};

export default function SettingsScreen() {
  const router = useRouter();
  const { preference, setPreference } = useTheme();
  const { locale, preference: localePreference, setPreference: setLocalePreference, t } = useI18n();
  const { user, service } = useAuth();
  const services = useAppServices();
  const [busy, setBusy] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [syncState, setSyncState] = useState<SyncState | null>(null);
  const [widgetPrivacy, setWidgetPrivacy] = useState<WidgetPrivacy>("counts_only");
  useEffect(() => {
    void readWidgetPrivacy().then(setWidgetPrivacy);
  }, []);
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
  const updateWidgetPrivacy = async (value: WidgetPrivacy) => {
    setWidgetPrivacy(value);
    await writeWidgetPrivacy(value);
    if (user) await refreshNativeWidgets(services, user.uid, locale, value);
  };
  const requestFocusNotification = async () => {
    if (Platform.OS !== "android" || Platform.Version < 33) return;
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
      {
        title: t("widgets.notificationPermission"),
        message: t("widgets.notificationDescription"),
        buttonPositive: t("common.confirm"),
        buttonNegative: t("common.cancel"),
      },
    );
    Alert.alert(
      result === PermissionsAndroid.RESULTS.GRANTED
        ? t("widgets.notificationEnabled")
        : t("widgets.notificationDenied"),
    );
  };
  const signOut = async () => {
    if (!service) return;
    setBusy(true);
    try {
      await clearWidgetsForAccountLifecycle();
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
              await clearWidgetsForAccountLifecycle();
              await services.deleteRemoteData(user.uid);
              await services.purgeLocalData(user.uid);
              await service.deleteAccount();
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

  const status = syncState?.status ?? "saved";

  return (
    <Screen padded={false}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.page}>
        <ResponsiveContent>
          <ScreenHeader
            title={t("tabs.settings")}
            subtitle={user?.email ?? t("settings.noSession")}
          />

          <SectionCard title={t("settings.sync")} icon="cloud-upload-outline">
            <View style={styles.statusRow}>
              <Badge
                label={t("settings.status", { status })}
                tone={syncTone[status] ?? "neutral"}
              />
              {syncState?.lastError ? (
                <StoneText variant="caption" tone="danger" numberOfLines={2}>
                  {syncState.lastError}
                </StoneText>
              ) : null}
            </View>
            <View style={styles.actionRow}>
              <StoneButton
                label={t("settings.syncNow")}
                variant="secondary"
                icon="sync-outline"
                size="sm"
                onPress={() => void runSync()}
                disabled={busy || !user}
              />
              <StoneButton
                label={t("settings.conflicts")}
                variant="quiet"
                size="sm"
                onPress={() => router.push("/conflicts")}
              />
            </View>
          </SectionCard>

          <SectionCard
            title={t("settings.theme")}
            description={t("settings.themePersistence")}
            icon="contrast-outline"
          >
            <ChoiceRow>
              {(["system", "light", "dark"] as const).map((option) => (
                <Chip
                  key={option}
                  label={
                    option === "system"
                      ? t("settings.theme.system")
                      : option === "light"
                        ? t("settings.theme.light")
                        : t("settings.theme.dark")
                  }
                  icon={
                    option === "system"
                      ? "phone-portrait-outline"
                      : option === "light"
                        ? "sunny-outline"
                        : "moon-outline"
                  }
                  selected={preference === option}
                  onPress={() => void updateTheme(option)}
                />
              ))}
            </ChoiceRow>
          </SectionCard>

          <SectionCard
            title={t("locale.setting")}
            description={`${t("locale.description")} ${t("locale.persistence")}`}
            icon="language-outline"
          >
            <ChoiceRow>
              {(["system", "en", "tr"] as const).map((option) => {
                const label =
                  option === "system"
                    ? t("locale.system")
                    : option === "en"
                      ? t("locale.english")
                      : t("locale.turkish");
                return (
                  <Chip
                    key={option}
                    label={label}
                    selected={localePreference === option}
                    onPress={() => void setLocalePreference(option)}
                    accessibilityLabel={`${t("locale.setting")}: ${label}`}
                  />
                );
              })}
            </ChoiceRow>
          </SectionCard>

          <SectionCard
            title={t("widgets.privacy")}
            description={t("widgets.privacyDescription")}
            icon="eye-off-outline"
          >
            <ChoiceRow>
              {(["counts_only", "titles", "titles_and_context"] as const).map((option) => (
                <Chip
                  key={option}
                  label={t(`widgets.privacy.${option}`)}
                  selected={widgetPrivacy === option}
                  onPress={() => void updateWidgetPrivacy(option)}
                />
              ))}
            </ChoiceRow>
            {Platform.OS === "android" && Platform.Version >= 33 ? (
              <StoneButton
                label={t("widgets.enableNotification")}
                variant="secondary"
                size="sm"
                icon="notifications-outline"
                onPress={() => void requestFocusNotification()}
              />
            ) : null}
          </SectionCard>

          <SectionCard title={t("settings.noteManagement")} icon="archive-outline">
            <View style={styles.actionRow}>
              <StoneButton
                label={t("settings.openTrash")}
                variant="secondary"
                icon="trash-outline"
                size="sm"
                onPress={() => router.push("/trash")}
              />
              <StoneButton
                label={t("settings.exportWorkspace")}
                variant="secondary"
                icon="share-outline"
                size="sm"
                onPress={() => void exportAll()}
                disabled={busy || !user}
              />
              <StoneButton
                label={t("settings.restoreCalendar")}
                variant="secondary"
                icon="cloud-download-outline"
                size="sm"
                onPress={() => void restoreCalendar()}
                disabled={busy || !user}
              />
            </View>
          </SectionCard>

          <SectionCard title={t("settings.account")} icon="person-circle-outline">
            <StoneText variant="bodySmall" tone="secondary">
              {user?.email ?? t("settings.noSession")}
            </StoneText>
            <StoneButton
              label={busy ? t("settings.signingOut") : t("settings.signOut")}
              variant="secondary"
              icon="log-out-outline"
              onPress={() => void signOut()}
              disabled={busy}
            />
            <Divider />
            <Overline tone="danger">{t("settings.dangerZone")}</Overline>
            <StoneButton
              label={t("settings.deleteAccount")}
              variant="danger"
              icon="warning-outline"
              onPress={deleteAccount}
              disabled={busy || !user}
            />
          </SectionCard>
        </ResponsiveContent>
      </ScrollView>
    </Screen>
  );
}

function ChoiceRow({ children }: { children: ReactNode }) {
  return <View style={styles.choices}>{children}</View>;
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.giant },
  statusRow: { gap: spacing.xs },
  actionRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  choices: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
});
