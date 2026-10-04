import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Pressable, SectionList, StyleSheet, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { EmptyState } from "../src/components/states";
import { ResponsiveContent } from "../src/components/responsive";
import { IconButton, Overline, Screen, SearchField, StoneText } from "../src/components/ui";
import { useTheme } from "../src/design/theme";
import { spacing } from "../src/design/tokens";
import { useI18n } from "../src/i18n/provider";
import { useAppServices } from "../src/providers/app-provider";
import { useAuth } from "../src/providers/auth-provider";
import {
  EMPTY_SEARCH_RESULT,
  runGlobalSearch,
  type GlobalSearchHit,
  type GlobalSearchResult,
} from "../src/search/global-search";

const icons = {
  note: "document-text-outline",
  task: "checkbox-outline",
  project: "layers-outline",
  event: "calendar-outline",
} as const;

/** One search box over notes, tasks, projects and calendar items. */
export default function SearchScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const services = useAppServices();
  const { colors } = useTheme();
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<GlobalSearchResult>(EMPTY_SEARCH_RESULT);

  useEffect(() => {
    if (!user) return;
    let active = true;
    // Debounce typing so each keystroke does not hit SQLite four times.
    const timer = setTimeout(() => {
      void runGlobalSearch(
        {
          searchNotes: (text) => services.noteUseCases.list(user.uid, { search: text, limit: 20 }),
          searchTasks: (text) => services.taskUseCases.list(user.uid, { search: text, limit: 20 }),
          listProjects: () => services.projectUseCases.list(user.uid),
          listCalendar: () => services.calendar.listForExport(user.uid),
        },
        query,
      ).then((next) => {
        if (active) setResult(next);
      });
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, services, user]);

  const sections = useMemo(
    () =>
      (
        [
          [t("search.notes"), result.notes],
          [t("search.tasks"), result.tasks],
          [t("search.projects"), result.projects],
          [t("search.events"), result.events],
        ] as const
      )
        .filter(([, data]) => data.length > 0)
        .map(([title, data]) => ({ title, data: [...data] })),
    [result, t],
  );

  const open = (hit: GlobalSearchHit) => {
    if (hit.kind === "note") router.push({ pathname: "/editor", params: { id: hit.id } });
    else if (hit.kind === "task") router.push({ pathname: "/task/[id]", params: { id: hit.id } });
    else if (hit.kind === "project")
      router.push({ pathname: "/project/[id]", params: { id: hit.id } });
    else router.push({ pathname: "/calendar/[id]", params: { id: hit.id } });
  };

  return (
    <Screen>
      <ResponsiveContent>
        <View style={styles.header}>
          <IconButton
            icon="chevron-back"
            accessibilityLabel={t("common.back")}
            onPress={() => router.back()}
          />
          <StoneText variant="title1">{t("search.title")}</StoneText>
        </View>
        <SearchField
          value={query}
          onChangeText={setQuery}
          placeholder={t("search.placeholder")}
          accessibilityLabel={t("search.title")}
          onClear={() => setQuery("")}
        />
        <SectionList
          sections={sections}
          keyExtractor={(item) => `${item.kind}:${item.id}`}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.list}
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHeader}>
              <Overline>{section.title}</Overline>
            </View>
          )}
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={item.title}
              onPress={() => open(item)}
              style={({ pressed }) => [
                styles.row,
                { borderBottomColor: colors.border },
                pressed ? { backgroundColor: colors.surfacePressed } : null,
              ]}
            >
              <Ionicons name={icons[item.kind]} size={18} color={colors.primaryText} />
              <View style={styles.rowText}>
                <StoneText variant="body" numberOfLines={1}>
                  {item.title}
                </StoneText>
                {item.detail ? (
                  <StoneText variant="caption" tone="secondary" numberOfLines={2}>
                    {item.detail}
                  </StoneText>
                ) : null}
              </View>
            </Pressable>
          )}
          ListEmptyComponent={
            query.trim().length >= 2 ? (
              <EmptyState
                icon="search-outline"
                title={t("search.empty")}
                description={t("search.emptyDetail")}
              />
            ) : null
          }
        />
      </ResponsiveContent>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  list: { paddingBottom: spacing.giant },
  sectionHeader: { paddingTop: spacing.lg, paddingBottom: spacing.xs },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowText: { flex: 1, gap: 2 },
});
