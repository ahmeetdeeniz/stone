import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, View } from "react-native";
import {
  instantToZonedWallTime,
  zonedWallTimeToInstant,
  type CalendarItem,
  type Project,
} from "@stone/domain";
import { ErrorState, LoadingState } from "../../src/components/states";
import { ResponsiveContent } from "../../src/components/responsive";
import { Screen, StoneButton, StoneInput, StoneText } from "../../src/components/ui";
import { spacing } from "../../src/design/tokens";
import { useAppServices } from "../../src/providers/app-provider";
import { useAuth } from "../../src/providers/auth-provider";

const recurrenceOptions = ["none", "daily", "weekdays", "weekly", "monthly", "custom"] as const;
type RecurrenceChoice = (typeof recurrenceOptions)[number];

export default function CalendarDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const { calendar, projectUseCases, deviceId } = useAppServices();
  const [item, setItem] = useState<CalendarItem | null>(null);
  const [projects, setProjects] = useState<readonly Project[]>([]);
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
  const [recurrence, setRecurrence] = useState<RecurrenceChoice>("none");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    if (!user || !id) return;
    try {
      const [current, projectList] = await Promise.all([
        calendar.getById(user.uid, id),
        projectUseCases.list(user.uid),
      ]);
      if (!current) throw new Error("Etkinlik bulunamadı.");
      setItem(current);
      setProjects(projectList);
      setTitle(current.title);
      setDescription(current.description ?? "");
      setLocation(current.location ?? "");
      setStartDate(current.startDate);
      setEndDate(current.endDate);
      setTimezone(current.timezone);
      setAllDay(current.allDay);
      setProjectId(current.projectId);
      setRecurrence(current.recurrence?.frequency ?? "none");
      setStartTime(
        current.startAt ? instantToZonedWallTime(current.startAt, current.timezone).slice(11) : "",
      );
      setEndTime(
        current.endAt ? instantToZonedWallTime(current.endAt, current.timezone).slice(11) : "",
      );
      setError(null);
    } catch (caught) {
      setError(message(caught));
    }
  };
  useEffect(() => void load(), [id, user]);

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
      Alert.alert("Kaydedildi", "Değişiklik önce yerel SQLite'a kaydedildi.");
    } catch (caught) {
      Alert.alert("Etkinlik kaydedilemedi", message(caught));
    } finally {
      setSaving(false);
    }
  };

  const remove = () =>
    Alert.alert("Etkinliği sil", "Etkinlik soft-delete ile çöp durumuna alınacak.", [
      { text: "Vazgeç", style: "cancel" },
      {
        text: "Sil",
        style: "destructive",
        onPress: () =>
          void (async () => {
            if (!user || !item) return;
            await calendar.softDelete(user.uid, item.id, deviceId);
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
        <LoadingState label="Etkinlik yükleniyor" />
      </Screen>
    );
  return (
    <Screen padded={false}>
      <Stack.Screen options={{ title: item.kind === "task_block" ? "Zaman bloğu" : "Etkinlik" }} />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.page}>
        <ResponsiveContent>
          <StoneInput label="Başlık" value={title} onChangeText={setTitle} />
          <StoneInput
            label="Açıklama"
            value={description}
            onChangeText={setDescription}
            multiline
          />
          <StoneInput label="Konum" value={location} onChangeText={setLocation} />
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: allDay }}
            onPress={() => setAllDay((value) => !value)}
            style={styles.toggle}
          >
            <StoneText>{allDay ? "☑" : "☐"} Tüm gün</StoneText>
          </Pressable>
          <View style={styles.row}>
            <StoneInput
              label="Başlangıç tarihi"
              value={startDate}
              onChangeText={setStartDate}
              containerStyle={styles.field}
            />
            <StoneInput
              label="Bitiş tarihi"
              value={endDate}
              onChangeText={setEndDate}
              containerStyle={styles.field}
            />
          </View>
          {!allDay ? (
            <View style={styles.row}>
              <StoneInput
                label="Başlangıç saati"
                value={startTime}
                onChangeText={setStartTime}
                containerStyle={styles.field}
              />
              <StoneInput
                label="Bitiş saati"
                value={endTime}
                onChangeText={setEndTime}
                containerStyle={styles.field}
              />
            </View>
          ) : null}
          <StoneInput
            label="IANA zaman dilimi"
            value={timezone}
            onChangeText={setTimezone}
            autoCapitalize="none"
          />
          <StoneText variant="caption">
            Cihaz zaman dilimi değişirse an aynı kalır; tüm gün tarihleri kaymaz.
          </StoneText>
          <StoneText variant="label">Tekrar</StoneText>
          <ScrollView horizontal contentContainerStyle={styles.choices}>
            {recurrenceOptions.map((value) => (
              <Choice
                key={value}
                label={value}
                selected={recurrence === value}
                onPress={() => setRecurrence(value)}
              />
            ))}
          </ScrollView>
          <StoneText variant="label">Proje</StoneText>
          <ScrollView horizontal contentContainerStyle={styles.choices}>
            <Choice label="Projesiz" selected={!projectId} onPress={() => setProjectId(null)} />
            {projects.map((project) => (
              <Choice
                key={project.id}
                label={project.title}
                selected={projectId === project.id}
                onPress={() => setProjectId(project.id)}
              />
            ))}
          </ScrollView>
          {item.taskId ? (
            <StoneButton
              label="Bağlı görevi aç"
              variant="secondary"
              onPress={() =>
                router.push({ pathname: "/task/[id]" as never, params: { id: item.taskId! } })
              }
            />
          ) : null}
          {item.sourceDocumentId ? (
            <StoneButton
              label="Kaynak notu aç"
              variant="secondary"
              onPress={() =>
                router.push({ pathname: "/editor", params: { id: item.sourceDocumentId! } })
              }
            />
          ) : null}
          <StoneText variant="caption">Hatırlatıcı veya arka plan bildirimi planlanmaz.</StoneText>
          <StoneButton
            label={saving ? "Kaydediliyor" : "Kaydet"}
            onPress={() => void save()}
            disabled={saving || !title.trim()}
          />
          <StoneButton label="Etkinliği sil" variant="quiet" onPress={remove} />
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

function message(error: unknown): string {
  return error instanceof Error ? error.message : "Tekrar deneyin.";
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
