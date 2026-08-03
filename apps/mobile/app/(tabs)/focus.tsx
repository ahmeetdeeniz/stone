import * as Crypto from "expo-crypto";
import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, ScrollView, StyleSheet, View } from "react-native";
import {
  adjustFocusSession,
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
import { formatDateOnly, formatDuration, formatInstant, type Locale } from "@stone/i18n";
import { ResponsiveContent } from "../../src/components/responsive";
import { ErrorState, LoadingState } from "../../src/components/states";
import {
  Badge,
  Chip,
  Divider,
  IconButton,
  Metric,
  Overline,
  ProgressBar,
  Screen,
  ScreenHeader,
  SectionCard,
  StoneButton,
  StoneInput,
  StoneText,
  Surface,
} from "../../src/components/ui";
import { radii, spacing } from "../../src/design/tokens";
import { useTheme } from "../../src/design/theme";
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [correctionMinutes, setCorrectionMinutes] = useState("");
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

  const saveCorrection = async () => {
    if (!user || !editingId) return;
    const session = sessions.find((candidate) => candidate.id === editingId);
    const seconds = Math.round(Number(correctionMinutes) * 60);
    if (!session || !Number.isFinite(seconds) || seconds <= 0) {
      Alert.alert(t("focus.correctionFailed"));
      return;
    }
    try {
      await focus.save(
        user.uid,
        adjustFocusSession(session, seconds, session.note, {
          now: () => new Date().toISOString(),
        }),
        session.revision,
        deviceId,
      );
      setEditingId(null);
      setCorrectionMinutes("");
      await load();
    } catch {
      Alert.alert(t("focus.correctionFailed"), t("app.unknownError"));
    }
  };

  const deleteSession = (session: FocusSession) => {
    if (!user) return;
    Alert.alert(t("focus.deleteConfirm"), t("focus.deleteDetail"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("focus.delete"),
        style: "destructive",
        onPress: () => void focus.softDelete(user.uid, session.id, deviceId).then(load),
      },
    ]);
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
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <ResponsiveContent>
          <View style={styles.page}>
            <ScreenHeader title={t("focus.title")} subtitle={t("focus.subtitle")} />

            {active ? (
              <TimerCard
                session={active}
                displaySeconds={displaySeconds}
                onPause={() =>
                  void persistTransition(
                    pauseFocusSession(active, { now: () => new Date().toISOString() }),
                    active.revision,
                  )
                }
                onResume={() =>
                  void persistTransition(
                    resumeFocusSession(active, { now: () => new Date().toISOString() }),
                    active.revision,
                  )
                }
                onFinish={() =>
                  void persistTransition(
                    finishFocusSession(active, { now: () => new Date().toISOString() }),
                    active.revision,
                  )
                }
                onCancel={cancel}
              />
            ) : (
              <Surface style={styles.starter}>
                <StoneText variant="title3">{t("focus.noActive")}</StoneText>
                <View style={styles.choices}>
                  {modes.map((value) => (
                    <Chip
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
                    <Overline>{t("focus.presets")}</Overline>
                    <View style={styles.choices}>
                      {presets.map((value) => (
                        <Chip
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
                      icon="hourglass-outline"
                    />
                  </>
                ) : null}
                <View style={styles.row}>
                  <StoneInput
                    label={t("focus.category")}
                    value={category}
                    onChangeText={setCategory}
                    containerStyle={styles.field}
                    icon="pricetag-outline"
                  />
                  <StoneInput
                    label={t("focus.sessionNote")}
                    value={note}
                    onChangeText={setNote}
                    containerStyle={styles.field}
                  />
                </View>
                <StoneText variant="caption" tone="muted">
                  {t("focus.linkHint")}
                </StoneText>
                <StoneButton label={t("focus.start")} icon="play" onPress={() => void start()} />
              </Surface>
            )}

            {progress ? (
              <SectionCard title={t("focus.goals")} icon="trophy-outline">
                <GoalRow
                  label={t("focus.dailyGoal")}
                  actual={progress.dailySeconds}
                  target={progress.dailyTargetSeconds}
                  locale={locale}
                />
                <GoalRow
                  label={t("focus.weeklyGoal")}
                  actual={progress.weeklySeconds}
                  target={progress.weeklyTargetSeconds}
                  locale={locale}
                />
                <Divider />
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
                <StoneButton
                  label={t("focus.saveGoals")}
                  variant="secondary"
                  onPress={() => void saveGoal()}
                />
                <StoneText variant="caption" tone="muted">
                  {t("focus.noStreak")}
                </StoneText>
              </SectionCard>
            ) : null}

            <SectionCard title={t("focus.analytics")} icon="stats-chart-outline">
              {summary.completedSessions === 0 ? (
                <StoneText variant="bodySmall" tone="secondary">
                  {t("focus.analyticsEmpty")}
                </StoneText>
              ) : (
                <>
                  <View style={styles.metrics}>
                    <Metric
                      value={String(summary.completedSessions)}
                      label={t("focus.completedLabel")}
                    />
                    <Metric
                      value={formatDuration(locale, Math.round(summary.focusedSeconds / 60))}
                      label={t("focus.focusedLabel")}
                      tone="accent"
                    />
                    <Metric
                      value={formatDuration(locale, Math.round(summary.averageSessionSeconds / 60))}
                      label={t("focus.average")}
                    />
                    <Metric
                      value={formatDuration(locale, Math.round(summary.breakSeconds / 60))}
                      label={t("focus.breakLabel")}
                    />
                  </View>
                  <StoneText variant="caption" tone="muted">
                    {t("focus.plannedVsActual", {
                      planned: formatDuration(locale, Math.round(summary.plannedSeconds / 60)),
                      actual: formatDuration(locale, Math.round(summary.focusedSeconds / 60)),
                    })}
                  </StoneText>
                  {summary.excludedConflictedSessions + summary.excludedOverlappingSessions > 0 ? (
                    <StoneText variant="caption" tone="warning">
                      {t("focus.excluded", {
                        count:
                          summary.excludedConflictedSessions + summary.excludedOverlappingSessions,
                      })}
                    </StoneText>
                  ) : null}
                </>
              )}
            </SectionCard>

            <SectionCard title={t("focus.manual")} icon="create-outline">
              <View style={styles.row}>
                <StoneInput
                  label={t("focus.manualStart")}
                  value={manualStart}
                  onChangeText={setManualStart}
                  autoCapitalize="none"
                  containerStyle={styles.field}
                />
                <StoneInput
                  label={t("focus.manualEnd")}
                  value={manualEnd}
                  onChangeText={setManualEnd}
                  autoCapitalize="none"
                  containerStyle={styles.field}
                />
              </View>
              <StoneButton
                label={t("focus.addManual")}
                variant="secondary"
                icon="add"
                onPress={() => void addManual()}
                disabled={!manualStart || !manualEnd}
              />
            </SectionCard>

            <View style={styles.history}>
              <Overline>{t("focus.recent")}</Overline>
              {recent.length === 0 ? (
                <StoneText variant="bodySmall" tone="secondary">
                  {t("focus.noHistory")}
                </StoneText>
              ) : null}
              {recent.map((session) => (
                <Surface key={session.id} style={styles.historyCard}>
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
                    style={styles.historyBody}
                  >
                    <StoneText variant="title3">
                      {formatDuration(
                        locale,
                        Math.max(1, Math.round(session.actualFocusSeconds / 60)),
                      )}
                    </StoneText>
                    <StoneText variant="caption" tone="muted">
                      {formatInstant(locale, session.startedAt, timezone)}
                    </StoneText>
                    <View style={styles.historyBadges}>
                      <Badge label={modeLabel(session.mode, t)} tone="accent" />
                      <Badge label={phaseLabel(session.phase, t)} tone="neutral" />
                      {session.category ? (
                        <Badge label={session.category} tone="info" icon="pricetag-outline" />
                      ) : null}
                      {session.manuallyAdjustedSeconds !== null ? (
                        <Badge label={t("focus.manualBadge")} tone="warning" />
                      ) : null}
                    </View>
                  </View>
                  <View style={styles.historyActions}>
                    <IconButton
                      icon="pencil-outline"
                      accessibilityLabel={t("focus.correct")}
                      active={editingId === session.id}
                      onPress={() => {
                        setEditingId(editingId === session.id ? null : session.id);
                        setCorrectionMinutes(
                          String(Math.max(1, Math.round(session.actualFocusSeconds / 60))),
                        );
                      }}
                    />
                    <IconButton
                      icon="trash-outline"
                      tone="muted"
                      accessibilityLabel={t("focus.delete")}
                      onPress={() => deleteSession(session)}
                    />
                  </View>
                  {editingId === session.id ? (
                    <View style={styles.correction}>
                      <StoneInput
                        label={t("focus.correctionMinutes")}
                        keyboardType="number-pad"
                        value={correctionMinutes}
                        onChangeText={setCorrectionMinutes}
                        containerStyle={styles.field}
                      />
                      <StoneButton
                        label={t("focus.saveCorrection")}
                        size="sm"
                        onPress={() => void saveCorrection()}
                      />
                    </View>
                  ) : null}
                </Surface>
              ))}
            </View>
            <StoneText variant="caption" tone="muted" style={styles.notice}>
              {t("focus.inAppNotice")}
            </StoneText>
          </View>
        </ResponsiveContent>
      </ScrollView>
    </Screen>
  );
}

/** The one place in the app that earns a large, quiet, full-bleed number. */
function TimerCard({
  session,
  displaySeconds,
  onPause,
  onResume,
  onFinish,
  onCancel,
}: {
  session: FocusSession;
  displaySeconds: number;
  onPause: () => void;
  onResume: () => void;
  onFinish: () => void;
  onCancel: () => void;
}) {
  const { colors, elevation } = useTheme();
  const { locale, t } = useI18n();
  const running = session.status === "running";
  const total = session.plannedDurationSeconds;
  const ratio = total ? 1 - Math.max(0, Math.min(1, displaySeconds / total)) : 0;
  return (
    <View
      accessible
      accessibilityLabel={t("focus.timerA11y", {
        mode: modeLabel(session.mode, t),
        state: t(`focus.${session.status}`),
        duration: timerText(displaySeconds),
      })}
      style={[
        styles.timerCard,
        { backgroundColor: colors.surface, borderColor: colors.primarySoftBorder },
        elevation.md,
      ]}
    >
      <View style={styles.timerBadges}>
        <Badge label={modeLabel(session.mode, t)} tone="accent" />
        <Badge label={phaseLabel(session.phase, t)} tone="neutral" />
        <Badge
          label={t(`focus.${session.status}`)}
          tone={running ? "success" : "warning"}
          icon={running ? "play" : "pause"}
        />
      </View>
      <StoneText style={[styles.timer, { color: colors.text }]}>
        {timerText(displaySeconds)}
      </StoneText>
      {total ? (
        <>
          <StoneText variant="caption" tone="muted">
            {t("focus.planned", { duration: formatDuration(locale, Math.ceil(total / 60)) })}
          </StoneText>
          <View style={styles.timerProgress}>
            <ProgressBar
              value={ratio}
              accessibilityLabel={t("focus.planned", {
                duration: formatDuration(locale, Math.ceil(total / 60)),
              })}
            />
          </View>
        </>
      ) : null}
      <View style={styles.timerActions}>
        <StoneButton
          label={running ? t("focus.pause") : t("focus.resume")}
          icon={running ? "pause" : "play"}
          onPress={running ? onPause : onResume}
          style={styles.timerPrimary}
        />
        <StoneButton
          label={t("focus.finish")}
          variant="secondary"
          icon="checkmark"
          onPress={onFinish}
          style={styles.timerPrimary}
        />
      </View>
      <StoneButton label={t("focus.cancel")} variant="quiet" size="sm" onPress={onCancel} />
    </View>
  );
}

function GoalRow({
  label,
  actual,
  target,
  locale,
}: {
  label: string;
  actual: number;
  target: number;
  locale: Locale;
}) {
  const reached = target > 0 && actual >= target;
  return (
    <View style={styles.goalRow}>
      <View style={styles.goalLabels}>
        <StoneText variant="label" tone="secondary">
          {label}
        </StoneText>
        <StoneText variant="label" tone={reached ? "success" : "default"}>
          {formatDuration(locale, Math.round(actual / 60))} /{" "}
          {formatDuration(locale, Math.round(target / 60))}
        </StoneText>
      </View>
      <ProgressBar
        value={target > 0 ? actual / target : 0}
        tone={reached ? "success" : "accent"}
        accessibilityLabel={label}
      />
    </View>
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
  page: { paddingHorizontal: spacing.lg, paddingVertical: spacing.lg, gap: spacing.lg },

  timerCard: {
    alignItems: "center",
    gap: spacing.md,
    borderWidth: 1,
    borderRadius: radii.xl,
    padding: spacing.xxl,
  },
  timerBadges: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: spacing.xs,
  },
  timer: {
    fontFamily: "Inter_700Bold",
    fontSize: 64,
    lineHeight: 72,
    letterSpacing: -2,
    fontVariant: ["tabular-nums"],
  },
  timerProgress: { alignSelf: "stretch" },
  timerActions: {
    flexDirection: "row",
    alignSelf: "stretch",
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  timerPrimary: { flex: 1 },

  starter: { gap: spacing.md },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  field: { flex: 1, minWidth: 140 },

  metrics: { flexDirection: "row", flexWrap: "wrap", gap: spacing.lg, rowGap: spacing.md },

  goalRow: { gap: spacing.xs },
  goalLabels: { flexDirection: "row", justifyContent: "space-between", gap: spacing.sm },

  history: { gap: spacing.sm },
  historyCard: { flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start" },
  historyBody: { flex: 1, gap: spacing.xxs, minWidth: 180 },
  historyBadges: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.xs },
  historyActions: { flexDirection: "row", marginRight: -spacing.sm },
  correction: { width: "100%", gap: spacing.sm, marginTop: spacing.md },

  notice: { textAlign: "center", marginTop: spacing.sm },
});
