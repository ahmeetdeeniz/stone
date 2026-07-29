import { Stack, useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, View } from "react-native";
import {
  instantToZonedWallTime,
  zonedWallTimeToInstant,
  type CalendarItem,
  type Document,
  type Project,
} from "@stone/domain";
import { ErrorState, LoadingState } from "../../src/components/states";
import { ResponsiveContent } from "../../src/components/responsive";
import { Screen, StoneButton, StoneInput, StoneText } from "../../src/components/ui";
import { spacing } from "../../src/design/tokens";
import { useAppServices } from "../../src/providers/app-provider";
import { useAuth } from "../../src/providers/auth-provider";
import { useI18n } from "../../src/i18n/provider";

const recurrenceOptions = ["none", "daily", "weekdays", "weekly", "monthly", "custom"] as const;
const categoryOptions = ["neutral", "purple", "blue", "green", "amber", "red"] as const;
type RecurrenceChoice = (typeof recurrenceOptions)[number];

export default function CalendarDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const navigation = useNavigation();
  const { user } = useAuth();
  const { calendar, projectUseCases, noteUseCases, deviceId } = useAppServices();
  const { t } = useI18n();
  const [item, setItem] = useState<CalendarItem | null>(null);
  const [projects, setProjects] = useState<readonly Project[]>([]);
  const [notes, setNotes] = useState<readonly Document[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [timezone, setTimezone] = useState("");
  const [allDay, setAllDay] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [sourceDocumentId, setSourceDocumentId] = useState<string | null>(null);
  const [category, setCategory] = useState<CalendarItem["category"]>("purple");
  const [recurrence, setRecurrence] = useState<RecurrenceChoice>("none");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const baselineRef = useRef("");
  const allowNavigationRef = useRef(false);
  const formSnapshot = JSON.stringify({
    title,
    description,
    location,
    startDate,
    endDate,
    startTime,
    endTime,
    timezone,
    allDay,
    projectId,
    sourceDocumentId,
    category,
    recurrence,
  });
  const isDirty = Boolean(item) && baselineRef.current !== formSnapshot;

  const load = async () => {
    if (!user || !id) return;
    try {
      const [current, projectList, noteList] = await Promise.all([
        calendar.getById(user.uid, id),
        projectUseCases.list(user.uid),
        noteUseCases.list(user.uid),
      ]);
      if (!current) throw new Error(t("calendar.notFound"));
      setItem(current);
      setProjects(projectList);
      setNotes(noteList);
      setTitle(current.title);
      setDescription(current.description ?? "");
      setLocation(current.location ?? "");
      setStartDate(current.startDate);
      setEndDate(current.endDate);
      setTimezone(current.timezone);
      setAllDay(current.allDay);
      setProjectId(current.projectId);
      setSourceDocumentId(current.sourceDocumentId);
      setCategory(current.category);
      setRecurrence(current.recurrence?.frequency ?? "none");
      setStartTime(
        current.startAt ? instantToZonedWallTime(current.startAt, current.timezone).slice(11) : "",
      );
      setEndTime(
        current.endAt ? instantToZonedWallTime(current.endAt, current.timezone).slice(11) : "",
      );
      baselineRef.current = JSON.stringify({
        title: current.title,
        description: current.description ?? "",
        location: current.location ?? "",
        startDate: current.startDate,
        endDate: current.endDate,
        startTime: current.startAt
          ? instantToZonedWallTime(current.startAt, current.timezone).slice(11)
          : "",
        endTime: current.endAt
          ? instantToZonedWallTime(current.endAt, current.timezone).slice(11)
          : "",
        timezone: current.timezone,
        allDay: current.allDay,
        projectId: current.projectId,
        sourceDocumentId: current.sourceDocumentId,
        category: current.category,
        recurrence: current.recurrence?.frequency ?? "none",
      });
      setError(null);
    } catch (caught) {
      setError(message(caught, t("app.unknownError")));
    }
  };
  useEffect(() => void load(), [id, user]);
  useEffect(
    () =>
      navigation.addListener("beforeRemove", (event) => {
        if (!isDirty || allowNavigationRef.current) return;
        event.preventDefault();
        Alert.alert(t("calendar.unsavedTitle"), t("calendar.unsavedDetail"), [
          { text: t("calendar.keepEditing"), style: "cancel" },
          {
            text: t("calendar.discardChanges"),
            style: "destructive",
            onPress: () => {
              allowNavigationRef.current = true;
              navigation.dispatch(event.data.action);
            },
          },
        ]);
      }),
    [isDirty, navigation],
  );

  const save = async () => {
    if (!user || !item) return;
    setSaving(true);
    try {
      const next = await calendar.save(
        user.uid,
        {
          ...item,
          title,
          description: description.trim() || null,
          location: location.trim() || null,
          startDate,
          endDate,
          timezone,
          allDay,
          startAt: allDay
            ? null
            : zonedWallTimeToInstant(startDate, startTime, timezone, "earlier"),
          endAt: allDay ? null : zonedWallTimeToInstant(endDate, endTime, timezone, "later"),
          projectId,
          sourceDocumentId,
          category,
          recurrence:
            recurrence === "none"
              ? null
              : {
                  frequency: recurrence,
                  interval: 1,
                  unit:
                    recurrence === "weekly" ? "week" : recurrence === "monthly" ? "month" : "day",
                  preferredDayOfMonth:
                    recurrence === "monthly" ? Number(startDate.slice(-2)) : null,
                  untilDate: null,
                },
          recurrenceSeriesId: recurrence === "none" ? null : (item.recurrenceSeriesId ?? item.id),
        },
        item.revision,
        deviceId,
      );
      setItem(next);
      baselineRef.current = formSnapshot;
      Alert.alert(t("calendar.saved"), t("calendar.savedLocally"));
    } catch (caught) {
      Alert.alert(t("calendar.saveFailed"), message(caught, t("app.unknownError")));
    } finally {
      setSaving(false);
    }
  };

  const remove = () =>
    Alert.alert(t("calendar.deleteEvent"), t("calendar.deleteDetail"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.delete"),
        style: "destructive",
        onPress: () =>
          void (async () => {
            if (!user || !item) return;
            await calendar.softDelete(user.uid, item.id, deviceId);
            allowNavigationRef.current = true;
            router.back();
          })(),
      },
    ]);

  if (error)
    return (
      <Screen>
        <ErrorState message={error} onRetry={() => void load()} />
      </Screen>
    );
  if (!item)
    return (
      <Screen>
        <LoadingState label={t("calendar.loadingEvent")} />
      </Screen>
    );
  return (
    <Screen padded={false}>
      <Stack.Screen
        options={{
          title: item.kind === "task_block" ? t("calendar.taskBlock") : t("calendar.event"),
        }}
      />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.page}>
        <ResponsiveContent>
          <StoneInput label={t("calendar.titleField")} value={title} onChangeText={setTitle} />
          <StoneInput
            label={t("calendar.description")}
            value={description}
            onChangeText={setDescription}
            multiline
          />
          <StoneInput label={t("calendar.location")} value={location} onChangeText={setLocation} />
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: allDay }}
            onPress={() => setAllDay((value) => !value)}
            style={styles.toggle}
          >
            <StoneText>
              {allDay ? "☑" : "☐"} {t("calendar.allDay")}
            </StoneText>
          </Pressable>
          <View style={styles.row}>
            <StoneInput
              label={t("calendar.startDate")}
              value={startDate}
              onChangeText={setStartDate}
              containerStyle={styles.field}
            />
            <StoneInput
              label={t("calendar.endDate")}
              value={endDate}
              onChangeText={setEndDate}
              containerStyle={styles.field}
            />
          </View>
          {!allDay ? (
            <View style={styles.row}>
              <StoneInput
                label={t("calendar.startTime")}
                value={startTime}
                onChangeText={setStartTime}
                containerStyle={styles.field}
              />
              <StoneInput
                label={t("calendar.endTime")}
                value={endTime}
                onChangeText={setEndTime}
                containerStyle={styles.field}
              />
            </View>
          ) : null}
          <StoneInput
            label={t("calendar.timezone")}
            value={timezone}
            onChangeText={setTimezone}
            autoCapitalize="none"
          />
          <StoneText variant="caption">{t("calendar.timezoneHint")}</StoneText>
          <StoneText variant="label">{t("calendar.recurrence")}</StoneText>
          <ScrollView horizontal contentContainerStyle={styles.choices}>
            {recurrenceOptions.map((value) => (
              <Choice
                key={value}
                label={recurrenceLabel(value, t)}
                selected={recurrence === value}
                onPress={() => setRecurrence(value)}
              />
            ))}
          </ScrollView>
          <StoneText variant="label">{t("calendar.project")}</StoneText>
          <ScrollView horizontal contentContainerStyle={styles.choices}>
            <Choice
              label={t("calendar.noProject")}
              selected={!projectId}
              onPress={() => setProjectId(null)}
            />
            {projects.map((project) => (
              <Choice
                key={project.id}
                label={project.title}
                selected={projectId === project.id}
                onPress={() => setProjectId(project.id)}
              />
            ))}
          </ScrollView>
          <StoneText variant="label">{t("calendar.category")}</StoneText>
          <ScrollView horizontal contentContainerStyle={styles.choices}>
            {categoryOptions.map((value) => (
              <Choice
                key={value}
                label={t(`calendar.category.${value}`)}
                selected={category === value}
                onPress={() => setCategory(value)}
              />
            ))}
          </ScrollView>
          <StoneText variant="label">{t("calendar.sourceNote")}</StoneText>
          <ScrollView horizontal contentContainerStyle={styles.choices}>
            <Choice
              label={t("calendar.noLink")}
              selected={!sourceDocumentId}
              onPress={() => setSourceDocumentId(null)}
            />
            {notes.slice(0, 200).map((note) => (
              <Choice
                key={note.id}
                label={note.title}
                selected={sourceDocumentId === note.id}
                onPress={() => setSourceDocumentId(note.id)}
              />
            ))}
          </ScrollView>
          {item.taskId ? (
            <StoneButton
              label={t("calendar.openTask")}
              variant="secondary"
              onPress={() =>
                router.push({ pathname: "/task/[id]" as never, params: { id: item.taskId! } })
              }
            />
          ) : null}
          {item.sourceDocumentId ? (
            <StoneButton
              label={t("calendar.openSourceNote")}
              variant="secondary"
              onPress={() =>
                router.push({ pathname: "/editor", params: { id: item.sourceDocumentId! } })
              }
            />
          ) : null}
          <StoneText variant="caption">{t("calendar.noNotifications")}</StoneText>
          <StoneButton
            label={saving ? t("calendar.saving") : t("common.save")}
            onPress={() => void save()}
            disabled={saving || !title.trim()}
          />
          <StoneButton label={t("calendar.deleteEvent")} variant="quiet" onPress={remove} />
        </ResponsiveContent>
      </ScrollView>
    </Screen>
  );
}

function Choice({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.choice, selected && styles.choiceSelected]}
    >
      <StoneText variant="label">{label}</StoneText>
    </Pressable>
  );
}

function recurrenceLabel(recurrence: RecurrenceChoice, t: ReturnType<typeof useI18n>["t"]): string {
  return t(`recurrence.${recurrence}`);
}

function message(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: spacing.lg, paddingVertical: spacing.xl },
  row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  field: { flex: 1, minWidth: 160 },
  toggle: { minHeight: 48, justifyContent: "center" },
  choices: { gap: spacing.sm, paddingVertical: spacing.sm },
  choice: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    borderWidth: 1,
    borderColor: "#D4CEE3",
    borderRadius: 999,
  },
  choiceSelected: { backgroundColor: "#E8E5FF", borderColor: "#8075F0" },
});
