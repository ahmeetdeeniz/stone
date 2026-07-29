import * as Crypto from "expo-crypto";
import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, View } from "react-native";
import {
  aggregateFocusSessions,
  cancelFocusSession,
  createManualFocusSession,
  elapsedFocusSeconds,
  finishFocusSession,
  focusGoalProgress,
  isFocusExpired,
  pauseFocusSession,
  remainingFocusSeconds,
  resumeFocusSession,
  startFocusSession,
  type FocusGoal,
  type FocusMode,
  type FocusSession,
} from "@stone/domain";
import { formatDateOnly, formatDuration, formatInstant } from "@stone/i18n";
import { ResponsiveContent } from "../../src/components/responsive";
import { ErrorState, LoadingState } from "../../src/components/states";
import { Screen, StoneButton, StoneInput, StoneText, Surface } from "../../src/components/ui";
import { spacing } from "../../src/design/tokens";
import { useI18n } from "../../src/i18n/provider";
import { useAuth } from "../../src/providers/auth-provider";
import { useAppServices } from "../../src/providers/app-provider";

const modes: readonly FocusMode[] = ["stopwatch", "countdown", "pomodoro"];
const presets = [15, 25, 45, 60] as const;

export default function FocusScreen() {
  const relationships = useLocalSearchParams<{
    taskId?: string;
    projectId?: string;
    documentId?: string;
    calendarItemId?: string;
  }>();
  const { user } = useAuth();
  const { focus, deviceId } = useAppServices();
  const { locale, t } = useI18n();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<FocusSession | null>(null);
  const [sessions, setSessions] = useState<readonly FocusSession[]>([]);
  const [goal, setGoal] = useState<FocusGoal | null>(null);
  const [mode, setMode] = useState<FocusMode>("pomodoro");
  const [minutes, setMinutes] = useState("25");
  const [category, setCategory] = useState("");
  const [note, setNote] = useState("");
  const [dailyGoal, setDailyGoal] = useState("60");
  const [weeklyGoal, setWeeklyGoal] = useState("300");
  const [manualStart, setManualStart] = useState("");
  const [manualEnd, setManualEnd] = useState("");
  const [now, setNow] = useState(() => new Date().toISOString());

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const endAt = new Date().toISOString();
      const start = new Date(endAt);
      start.setUTCDate(start.getUTCDate() - 30);
      const [activeSessions, history, storedGoal] = await Promise.all([
        focus.getActive(user.uid),
        focus.list(user.uid, { startAt: start.toISOString(), endAt, limit: 2_000 }),
        focus.getGoal(user.uid),
      ]);
      setActive(activeSessions[0] ?? null);
      setSessions(history);
      setGoal(storedGoal);
      if (storedGoal) {
        setDailyGoal(String(storedGoal.dailyMinutes));
        setWeeklyGoal(String(storedGoal.weeklyMinutes));
      }
      setError(null);
    } catch {
      setError(t("focus.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [focus, t, user]);

  useEffect(() => void load(), [load]);
  useEffect(() => {
    if (!active || active.status !== "running") return;
    const timer = setInterval(() => setNow(new Date().toISOString()), 1_000);
    return () => clearInterval(timer);
  }, [active]);

  const persistTransition = async (next: FocusSession, previousRevision: number) => {
    if (!user) return;
    try {
      const saved = await focus.save(user.uid, next, previousRevision, deviceId);
      setActive(saved.status === "running" || saved.status === "paused" ? saved : null);
      await load();
    } catch {
      Alert.alert(t("focus.updateFailed"), t("app.unknownError"));
    }
  };

  useEffect(() => {
    if (!active || !isFocusExpired(active, now)) return;
    const completed = finishFocusSession(active, { now: () => now });
    void persistTransition(completed, active.revision);
    Alert.alert(t("focus.expired"), t("focus.expiredDetail"));
  }, [active, now]);

  const start = async () => {
    if (!user) return;
    try {
      const existing = await focus.getActive(user.uid);
      if (existing.length) {
        setActive(existing[0] ?? null);
        Alert.alert(t("focus.activeElsewhere"));
        return;
      }
      const duration = mode === "stopwatch" ? null : Math.max(1, Number(minutes)) * 60;
      const session = startFocusSession(
        {
          id: Crypto.randomUUID(),
          ownerId: user.uid,
          deviceId,
          mode,
          plannedDurationSeconds: duration,
          category: category.trim() || null,
          note: note.trim() || null,
          taskId: relationships.taskId ?? null,
          projectId: relationships.projectId ?? null,
          sourceDocumentId: relationships.documentId ?? null,
          calendarItemId: relationships.calendarItemId ?? null,
          pomodoroGroupId: mode === "pomodoro" ? Crypto.randomUUID() : null,
          pomodoroCycle: mode === "pomodoro" ? 0 : null,
        },
        { now: () => new Date().toISOString() },
      );
      setActive(await focus.create(session));
      setNow(session.startedAt);
    } catch {
      Alert.alert(t("focus.startFailed"), t("app.unknownError"));
    }
  };

  const cancel = () => {
    if (!active) return;
    Alert.alert(t("focus.confirmCancel"), t("focus.confirmCancelDetail"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("focus.cancel"),
        style: "destructive",
        onPress: () =>
          void persistTransition(
            cancelFocusSession(active, { now: () => new Date().toISOString() }),
            active.revision,
          ),
      },
    ]);
  };

  const addManual = async () => {
    if (!user) return;
    try {
      const session = createManualFocusSession(
        {
          id: Crypto.randomUUID(),
          ownerId: user.uid,
          deviceId,
          mode: "stopwatch",
          startedAt: new Date(manualStart).toISOString(),
          endedAt: new Date(manualEnd).toISOString(),
          category: category.trim() || null,
          note: note.trim() || null,
        },
        { now: () => new Date().toISOString() },
      );
      await focus.create(session);
      setManualStart("");
      setManualEnd("");
      await load();
    } catch {
      Alert.alert(t("focus.manualFailed"), t("app.unknownError"));
    }
  };

  const saveGoal = async () => {
    if (!user) return;
    const timestamp = new Date().toISOString();
    const today = timestamp.slice(0, 10);
    const next: FocusGoal = {
      id: user.uid,
      ownerId: user.uid,
      schemaVersion: 1,
      timezone,
      dailyMinutes: Math.max(0, Math.trunc(Number(dailyGoal))),
      weeklyMinutes: Math.max(0, Math.trunc(Number(weeklyGoal))),
      effectiveFromDate: today,
      streakVisible: false,
      revision: goal?.revision ?? 0,
      createdAt: goal?.createdAt ?? timestamp,
      updatedAt: timestamp,
      deletedAt: null,
      updatedByDeviceId: deviceId,
    };
    try {
      const saved = await focus.saveGoal(next, goal?.revision ?? null);
      setGoal(saved);
      Alert.alert(t("focus.goalSaved"));
    } catch {
      Alert.alert(t("focus.goalFailed"), t("app.unknownError"));
    }
  };

  const summary = useMemo(() => aggregateFocusSessions(sessions, timezone), [sessions, timezone]);
  const progress =
    goal === null ? null : focusGoalProgress(sessions, goal, new Date().toISOString().slice(0, 10));
  const activeSeconds = active ? elapsedFocusSeconds(active, now) : 0;
  const displaySeconds = active ? (remainingFocusSeconds(active, now) ?? activeSeconds) : 0;
  const recent = sessions.filter((session) => session.status === "completed").slice(0, 12);

  if (loading) return <LoadingState label={t("app.loading")} />;
  if (error) return <ErrorState message={error} onRetry={() => void load()} />;

  return (
    <Screen padded={false}>
      <ScrollView keyboardShouldPersistTaps="handled">
        <ResponsiveContent>
          <View style={styles.page}>
            <View style={styles.header}>
              <StoneText variant="title1">{t("focus.title")}</StoneText>
              <StoneText>{t("focus.subtitle")}</StoneText>
            </View>

            {active ? (
              <Surface>
                <View
                  accessible
                  accessibilityLabel={t("focus.timerA11y", {
                    mode: modeLabel(active.mode, t),
                    state: t(`focus.${active.status}`),
                    duration: timerText(displaySeconds),
                  })}
                  style={styles.timerCard}
                >
                  <StoneText variant="label">
                    {modeLabel(active.mode, t)} · {phaseLabel(active.phase, t)} ·{" "}
                    {t(`focus.${active.status}`)}
                  </StoneText>
                  <StoneText style={styles.timer}>{timerText(displaySeconds)}</StoneText>
                  {active.plannedDurationSeconds ? (
                    <StoneText>
                      {t("focus.planned", {
                        duration: formatDuration(
                          locale,
                          Math.ceil(active.plannedDurationSeconds / 60),
                        ),
                      })}
                    </StoneText>
                  ) : null}
                  <View style={styles.actions}>
                    {active.status === "running" ? (
                      <StoneButton
                        label={t("focus.pause")}
                        onPress={() =>
                          void persistTransition(
                            pauseFocusSession(active, { now: () => new Date().toISOString() }),
                            active.revision,
                          )
                        }
                      />
                    ) : (
                      <StoneButton
                        label={t("focus.resume")}
                        onPress={() =>
                          void persistTransition(
                            resumeFocusSession(active, { now: () => new Date().toISOString() }),
                            active.revision,
                          )
                        }
                      />
                    )}
                    <StoneButton
                      label={t("focus.finish")}
                      variant="secondary"
                      onPress={() =>
                        void persistTransition(
                          finishFocusSession(active, { now: () => new Date().toISOString() }),
                          active.revision,
                        )
                      }
                    />
                    <StoneButton label={t("focus.cancel")} variant="quiet" onPress={cancel} />
                  </View>
                </View>
              </Surface>
            ) : (
              <Surface>
                <View style={styles.form}>
                  <StoneText variant="title3">{t("focus.noActive")}</StoneText>
                  <View style={styles.choices}>
                    {modes.map((value) => (
                      <Choice
                        key={value}
                        label={modeLabel(value, t)}
                        selected={mode === value}
                        onPress={() => {
                          setMode(value);
                          if (value === "pomodoro") setMinutes("25");
                        }}
                      />
                    ))}
                  </View>
                  {mode !== "stopwatch" ? (
                    <>
                      <StoneText variant="label">{t("focus.presets")}</StoneText>
                      <View style={styles.choices}>
                        {presets.map((value) => (
                          <Choice
                            key={value}
                            label={formatDuration(locale, value)}
                            selected={minutes === String(value)}
                            onPress={() => setMinutes(String(value))}
                          />
                        ))}
                      </View>
                      <StoneInput
                        label={t("focus.customMinutes")}
                        keyboardType="number-pad"
                        value={minutes}
                        onChangeText={setMinutes}
                      />
                    </>
                  ) : null}
                  <StoneInput
                    label={t("focus.category")}
                    value={category}
                    onChangeText={setCategory}
                  />
                  <StoneInput label={t("focus.sessionNote")} value={note} onChangeText={setNote} />
                  <StoneText variant="caption">{t("focus.linkHint")}</StoneText>
                  <StoneButton label={t("focus.start")} onPress={() => void start()} />
                </View>
              </Surface>
            )}

            <Surface>
              <View style={styles.form}>
                <StoneText variant="title3">{t("focus.analytics")}</StoneText>
                {summary.completedSessions === 0 ? (
                  <StoneText>{t("focus.analyticsEmpty")}</StoneText>
                ) : (
                  <>
                    <StoneText>
                      {t("focus.completedCount", { count: summary.completedSessions })}
                    </StoneText>
                    <StoneText>
                      {t("focus.plannedVsActual", {
                        planned: formatDuration(locale, Math.round(summary.plannedSeconds / 60)),
                        actual: formatDuration(locale, Math.round(summary.focusedSeconds / 60)),
                      })}
                    </StoneText>
                    <StoneText>
                      {t("focus.average")}:{" "}
                      {formatDuration(locale, Math.round(summary.averageSessionSeconds / 60))}
                    </StoneText>
                    <StoneText>
                      {t("focus.breakTime", {
                        duration: formatDuration(locale, Math.round(summary.breakSeconds / 60)),
                      })}
                    </StoneText>
                    {summary.excludedConflictedSessions + summary.excludedOverlappingSessions >
                    0 ? (
                      <StoneText>
                        {t("focus.excluded", {
                          count:
                            summary.excludedConflictedSessions +
                            summary.excludedOverlappingSessions,
                        })}
                      </StoneText>
                    ) : null}
                  </>
                )}
              </View>
            </Surface>

            <Surface>
              <View style={styles.form}>
                <StoneText variant="title3">{t("focus.goals")}</StoneText>
                {progress ? (
                  <>
                    <StoneText>
                      {t("focus.dailyProgress", {
                        actual: formatDuration(locale, Math.round(progress.dailySeconds / 60)),
                        target: formatDuration(
                          locale,
                          Math.round(progress.dailyTargetSeconds / 60),
                        ),
                      })}
                    </StoneText>
                    <StoneText>
                      {t("focus.weeklyProgress", {
                        actual: formatDuration(locale, Math.round(progress.weeklySeconds / 60)),
                        target: formatDuration(
                          locale,
                          Math.round(progress.weeklyTargetSeconds / 60),
                        ),
                      })}
                    </StoneText>
                  </>
                ) : null}
                <View style={styles.row}>
                  <StoneInput
                    label={t("focus.dailyGoal")}
                    keyboardType="number-pad"
                    value={dailyGoal}
                    onChangeText={setDailyGoal}
                    containerStyle={styles.field}
                  />
                  <StoneInput
                    label={t("focus.weeklyGoal")}
                    keyboardType="number-pad"
                    value={weeklyGoal}
                    onChangeText={setWeeklyGoal}
                    containerStyle={styles.field}
                  />
                </View>
                <StoneButton label={t("focus.saveGoals")} onPress={() => void saveGoal()} />
                <StoneText variant="caption">{t("focus.noStreak")}</StoneText>
              </View>
            </Surface>

            <Surface>
              <View style={styles.form}>
                <StoneText variant="title3">{t("focus.manual")}</StoneText>
                <StoneInput
                  label={t("focus.manualStart")}
                  value={manualStart}
                  onChangeText={setManualStart}
                  autoCapitalize="none"
                />
                <StoneInput
                  label={t("focus.manualEnd")}
                  value={manualEnd}
                  onChangeText={setManualEnd}
                  autoCapitalize="none"
                />
                <StoneButton
                  label={t("focus.addManual")}
                  onPress={() => void addManual()}
                  disabled={!manualStart || !manualEnd}
                />
              </View>
            </Surface>

            <View style={styles.form}>
              <StoneText variant="title3">{t("focus.recent")}</StoneText>
              {recent.length === 0 ? <StoneText>{t("focus.noHistory")}</StoneText> : null}
              {recent.map((session) => (
                <Surface key={session.id}>
                  <View
                    accessible
                    accessibilityLabel={t("focus.historyA11y", {
                      mode: modeLabel(session.mode, t),
                      date: formatDateOnly(locale, session.startedAt.slice(0, 10)),
                      duration: formatDuration(
                        locale,
                        Math.max(1, Math.round(session.actualFocusSeconds / 60)),
                      ),
                    })}
                    style={styles.history}
                  >
                    <StoneText variant="label">
                      {modeLabel(session.mode, t)} · {phaseLabel(session.phase, t)}
                    </StoneText>
                    <StoneText>
                      {formatInstant(locale, session.startedAt, timezone)} ·{" "}
                      {formatDuration(
                        locale,
                        Math.max(1, Math.round(session.actualFocusSeconds / 60)),
                      )}
                    </StoneText>
                    {session.category ? <StoneText>{session.category}</StoneText> : null}
                  </View>
                </Surface>
              ))}
            </View>
            <StoneText variant="caption">{t("focus.inAppNotice")}</StoneText>
          </View>
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

type Translate = ReturnType<typeof useI18n>["t"];

function modeLabel(mode: FocusMode, t: Translate): string {
  return t(`focus.${mode}`);
}

function phaseLabel(phase: FocusSession["phase"], t: Translate): string {
  return t(
    phase === "focus"
      ? "focus.focusPhase"
      : phase === "short_break"
        ? "focus.shortBreak"
        : "focus.longBreak",
  );
}

function timerText(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3_600);
  const minutes = Math.floor((safe % 3_600) / 60);
  const remainder = safe % 60;
  return hours > 0
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: spacing.lg, paddingVertical: spacing.xl, gap: spacing.lg },
  header: { gap: spacing.xs },
  form: { gap: spacing.md },
  timerCard: { alignItems: "center", gap: spacing.md },
  timer: {
    fontFamily: "Inter_700Bold",
    fontSize: 56,
    lineHeight: 68,
    fontVariant: ["tabular-nums"],
  },
  actions: { alignSelf: "stretch", gap: spacing.sm },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  choice: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    borderWidth: 1,
    borderColor: "#D4CEE3",
    borderRadius: 999,
  },
  choiceSelected: { borderColor: "#6F63E7", backgroundColor: "#E8E5FF" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  field: { flex: 1, minWidth: 140 },
  history: { gap: spacing.xs },
});
