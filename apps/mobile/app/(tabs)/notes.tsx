import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Alert, SectionList, StyleSheet, View } from "react-native";
import type { Document } from "@stone/domain";
import { ResponsiveContent } from "../../src/components/responsive";
import { EmptyState, ErrorState, LoadingState } from "../../src/components/states";
import {
  ActionSheet,
  IconButton,
  ListRow,
  Overline,
  Screen,
  ScreenHeader,
  SearchField,
  StoneButton,
  type IconName,
} from "../../src/components/ui";
import { hairline, radii, spacing } from "../../src/design/tokens";
import { useTheme } from "../../src/design/theme";
import { useAuth } from "../../src/providers/auth-provider";
import { useAppServices } from "../../src/providers/app-provider";
import { pickAndImportNote } from "../../src/notes/note-files";
import { useI18n } from "../../src/i18n/provider";
import {
  localIsoDate,
  newNoteDocument,
  NOTE_TEMPLATES,
  noteFromTemplate,
  type NoteTemplate,
} from "../../src/notes/templates";

export default function NotesScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { noteUseCases, notes: noteRepository, deviceId } = useAppServices();
  const { locale, t, tp } = useI18n();
  const [notes, setNotes] = useState<readonly Document[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadNotes = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      setError(null);
      setNotes(await noteUseCases.list(user.uid, search ? { search } : {}));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("notes.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [noteUseCases, search, user]);

  useFocusEffect(
    useCallback(() => {
      void loadNotes();
    }, [loadNotes]),
  );

  const createNote = async (template: NoteTemplate) => {
    if (!user) return;
    setBusy(true);
    try {
      const today = localIsoDate();
      // A daily note is unique per day: reopen it instead of creating a duplicate.
      const existing =
        template === "daily" ? await noteRepository.findByTitle(user.uid, today) : null;
      const note =
        existing ??
        (await noteUseCases.create(
          newNoteDocument({
            ownerId: user.uid,
            deviceId,
            ...noteFromTemplate(template, { t, today }),
          }),
        ));
      router.push({ pathname: "/editor", params: { id: note.id } });
    } catch (caught) {
      Alert.alert(
        t("notes.createFailed"),
        caught instanceof Error ? caught.message : t("notes.localSaveFailed"),
      );
    } finally {
      setBusy(false);
    }
  };

  const importNote = async () => {
    if (!user) return;
    setBusy(true);
    try {
      const note = await pickAndImportNote(user.uid, deviceId, noteUseCases);
      if (note) router.push({ pathname: "/editor", params: { id: note.id } });
    } catch (caught) {
      Alert.alert(
        t("notes.importFailed"),
        caught instanceof Error ? caught.message : t("notes.fileReadFailed"),
      );
    } finally {
      setBusy(false);
    }
  };

  const togglePin = async (note: Document) => {
    if (!user) return;
    try {
      await noteUseCases.setPinned(user.uid, note.id, !note.isPinned, deviceId);
      await loadNotes();
    } catch (caught) {
      Alert.alert(
        t("notes.updateFailed"),
        caught instanceof Error ? caught.message : t("app.unknownError"),
      );
    }
  };

  const moveToTrash = (note: Document) => {
    Alert.alert(t("notes.trashConfirm"), t("notes.trashDetail", { title: note.title }), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("notes.moveToTrash"),
        style: "destructive",
        onPress: () => {
          void noteUseCases
            .trash(user!.uid, note.id, deviceId)
            .then(loadNotes)
            .catch((caught: unknown) => {
              Alert.alert(
                t("notes.deleteFailed"),
                caught instanceof Error ? caught.message : t("app.unknownError"),
              );
            });
        },
      },
    ]);
  };

  const [createSheet, setCreateSheet] = useState(false);
  const [actionsFor, setActionsFor] = useState<Document | null>(null);
  const subtitle = useMemo(() => tp("notes.count", notes.length), [notes.length, tp]);
  const sections = useMemo(() => {
    const pinned = notes.filter((note) => note.isPinned);
    const others = notes.filter((note) => !note.isPinned);
    return [
      ...(pinned.length > 0 ? [{ key: "pinned", title: t("notes.pinned"), data: pinned }] : []),
      ...(others.length > 0
        ? [{ key: "all", title: pinned.length > 0 ? t("tabs.notes") : null, data: others }]
        : []),
    ];
  }, [notes, t]);

  return (
    <Screen>
      <ResponsiveContent>
        <ScreenHeader
          title={t("tabs.notes")}
          subtitle={loading ? undefined : subtitle}
          actions={
            <>
              <IconButton
                icon="search"
                accessibilityLabel={t("search.title")}
                onPress={() => router.push("/search")}
              />
              <IconButton
                icon="add"
                tone="accent"
                active
                accessibilityLabel={t("notes.new")}
                onPress={() => setCreateSheet(true)}
                disabled={busy}
                testID="notes-new"
              />
            </>
          }
        />
        <SearchField
          value={search}
          onChangeText={setSearch}
          placeholder={t("notes.searchPlaceholder")}
          accessibilityLabel={t("notes.search")}
          onClear={() => setSearch("")}
        />
        {loading && notes.length === 0 ? (
          <LoadingState label={t("notes.loading")} />
        ) : error ? (
          <ErrorState message={error} onRetry={() => void loadNotes()} />
        ) : (
          <SectionList
            sections={sections}
            keyExtractor={(item) => item.id}
            showsVerticalScrollIndicator={false}
            stickySectionHeadersEnabled={false}
            contentContainerStyle={notes.length === 0 ? styles.emptyList : styles.list}
            ListEmptyComponent={
              <EmptyState
                icon={search ? "search-outline" : "document-text-outline"}
                title={search ? t("notes.searchEmpty") : t("notes.emptyTitle")}
                description={search ? t("notes.searchEmptyDetail") : t("notes.emptyDetail")}
                action={
                  search ? null : (
                    <StoneButton
                      label={t("notes.new")}
                      icon="add"
                      onPress={() => void createNote("blank")}
                      disabled={busy}
                    />
                  )
                }
              />
            }
            renderSectionHeader={({ section }) =>
              section.title ? (
                <View style={styles.sectionHeader}>
                  <Overline>{section.title}</Overline>
                </View>
              ) : (
                <View style={styles.sectionGap} />
              )
            }
            renderItem={({ item, index, section }) => (
              <GroupedRow index={index} count={section.data.length}>
                <ListRow
                  title={item.title || t("notes.untitled")}
                  subtitle={preview(item, t("notes.emptyMarkdown"))}
                  meta={shortDate(locale, item.updatedAt)}
                  accessibilityLabel={t("notes.openA11y", { title: item.title })}
                  onPress={() => router.push({ pathname: "/editor", params: { id: item.id } })}
                  onLongPress={() => setActionsFor(item)}
                />
              </GroupedRow>
            )}
          />
        )}
      </ResponsiveContent>
      <ActionSheet
        visible={createSheet}
        title={t("notes.new")}
        onClose={() => setCreateSheet(false)}
        options={[
          ...NOTE_TEMPLATES.map((template) => ({
            label: t(`notes.template.${template}`),
            icon: templateIcons[template],
            onPress: () => void createNote(template),
          })),
          {
            label: t("notes.newDrawing"),
            icon: "brush-outline" as const,
            onPress: () => router.push({ pathname: "/drawing/[id]", params: { id: "new" } }),
          },
          {
            label: t("notes.openMarkdown"),
            icon: "folder-open-outline" as const,
            onPress: () => void importNote(),
          },
        ]}
      />
      <ActionSheet
        visible={actionsFor !== null}
        title={actionsFor?.title}
        onClose={() => setActionsFor(null)}
        options={
          actionsFor
            ? [
                {
                  label: actionsFor.isPinned ? t("notes.unpin") : t("notes.pin"),
                  icon: actionsFor.isPinned ? "pin" : "pin-outline",
                  onPress: () => void togglePin(actionsFor),
                },
                {
                  label: t("notes.moveToTrash"),
                  icon: "trash-outline",
                  destructive: true,
                  onPress: () => moveToTrash(actionsFor),
                },
              ]
            : []
        }
      />
    </Screen>
  );
}

const templateIcons: Readonly<Record<NoteTemplate, IconName>> = {
  blank: "document-outline",
  daily: "today-outline",
  meeting: "people-outline",
};

/** Wraps a list row so consecutive rows read as one rounded group with inset separators. */
function GroupedRow({
  index,
  count,
  children,
}: {
  index: number;
  count: number;
  children: ReactNode;
}) {
  const { colors } = useTheme();
  const first = index === 0;
  const last = index === count - 1;
  return (
    <View
      style={[
        styles.groupRow,
        { backgroundColor: colors.surface, borderColor: colors.border },
        first && styles.groupFirst,
        last && styles.groupLast,
      ]}
    >
      {!first ? <View style={[styles.groupSeparator, { backgroundColor: colors.border }]} /> : null}
      {children}
    </View>
  );
}

/** Body text without front matter, Markdown punctuation, or a heading repeating the title. */
function preview(note: Document, emptyLabel: string): string {
  const body = note.markdown
    .replace(/^---[\s\S]*?---\s*/u, "")
    .split("\n")
    .filter((line, index) => !(index === 0 && /^#\s/u.test(line)))
    .map((line) => line.replace(/^\s*(?:[-*+]|\d+\.)\s+(?:\[[ xX]\]\s+)?/u, ""))
    .join(" ")
    .replace(/[*_`>#]|^-\s|\[[ xX]\]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  return body || emptyLabel;
}

function shortDate(locale: string, instant: string): string {
  const date = new Date(instant);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  return new Intl.DateTimeFormat(
    locale,
    sameDay ? { hour: "2-digit", minute: "2-digit" } : { day: "numeric", month: "short" },
  ).format(date);
}

const styles = StyleSheet.create({
  list: { paddingTop: spacing.sm, paddingBottom: spacing.giant },
  emptyList: { flexGrow: 1 },
  sectionHeader: { paddingTop: spacing.lg, paddingBottom: spacing.sm },
  sectionGap: { height: spacing.md },
  groupRow: { borderLeftWidth: hairline, borderRightWidth: hairline, overflow: "hidden" },
  groupFirst: {
    borderTopWidth: hairline,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
  },
  groupLast: {
    borderBottomWidth: hairline,
    borderBottomLeftRadius: radii.lg,
    borderBottomRightRadius: radii.lg,
  },
  groupSeparator: { height: hairline, marginLeft: spacing.lg },
});
