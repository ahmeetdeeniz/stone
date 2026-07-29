import { useCallback, useEffect, useMemo, useState } from "react";
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
import { formatDuration, formatInstant } from "@stone/i18n";
import { desktopApi } from "./desktop-api";
import { useI18n } from "./i18n";

const modes: readonly FocusMode[] = ["stopwatch", "countdown", "pomodoro"];
const presets = [15, 25, 45, 60] as const;

export default function FocusPanel({ ownerId }: { ownerId: string }) {
  const { locale, t } = useI18n();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const [sessions, setSessions] = useState<readonly FocusSession[]>([]);
  const [active, setActive] = useState<FocusSession | null>(null);
  const [goal, setGoal] = useState<FocusGoal | null>(null);
  const [mode, setMode] = useState<FocusMode>("pomodoro");
  const [minutes, setMinutes] = useState(25);
  const [dailyGoal, setDailyGoal] = useState(60);
  const [weeklyGoal, setWeeklyGoal] = useState(300);
  const [manualStart, setManualStart] = useState("");
  const [manualEnd, setManualEnd] = useState("");
  const [category, setCategory] = useState("");
  const [note, setNote] = useState("");
  const [now, setNow] = useState(() => new Date().toISOString());
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const endAt = new Date().toISOString();
    const start = new Date(endAt);
    start.setUTCFullYear(start.getUTCFullYear() - 5);
    try {
      const [history, storedGoal] = await Promise.all([
        desktopApi.listFocusSessions(ownerId, start.toISOString(), endAt),
        desktopApi.getFocusGoal(ownerId),
      ]);
      setSessions(history);
      setActive(
        history.find((session) => session.status === "running" || session.status === "paused") ??
          null,
      );
      setGoal(storedGoal);
      if (storedGoal) {
        setDailyGoal(storedGoal.dailyMinutes);
        setWeeklyGoal(storedGoal.weeklyMinutes);
      }
      setMessage(null);
    } catch {
      setMessage(t("focus.loadFailed"));
    }
  }, [ownerId, t]);

  useEffect(() => void load(), [load]);
  useEffect(() => {
    if (!active || active.status !== "running") return;
    const timer = setInterval(() => setNow(new Date().toISOString()), 1_000);
    return () => clearInterval(timer);
  }, [active]);

  const save = async (session: FocusSession) => {
    try {
      const saved = await desktopApi.saveFocusSession(session);
      setActive(saved.status === "running" || saved.status === "paused" ? saved : null);
      await load();
    } catch {
      setMessage(t("focus.updateFailed"));
    }
  };

  useEffect(() => {
    if (!active || !isFocusExpired(active, now)) return;
    void save(finishFocusSession(active, { now: () => now }));
    setMessage(`${t("focus.expired")} — ${t("focus.expiredDetail")}`);
  }, [active, now]);

  const begin = async () => {
    if (active) {
      setMessage(t("focus.activeElsewhere"));
      return;
    }
    try {
      const session = startFocusSession(
        {
          id: crypto.randomUUID(),
          ownerId,
          deviceId: "desktop",
          mode,
          plannedDurationSeconds: mode === "stopwatch" ? null : minutes * 60,
          category: category.trim() || null,
          note: note.trim() || null,
          pomodoroGroupId: mode === "pomodoro" ? crypto.randomUUID() : null,
          pomodoroCycle: mode === "pomodoro" ? 0 : null,
        },
        { now: () => new Date().toISOString() },
      );
      setActive(await desktopApi.saveFocusSession(session));
    } catch {
      setMessage(t("focus.startFailed"));
    }
  };

  const addManual = async () => {
    try {
      const session = createManualFocusSession(
        {
          id: crypto.randomUUID(),
          ownerId,
          deviceId: "desktop",
          mode: "stopwatch",
          startedAt: new Date(manualStart).toISOString(),
          endedAt: new Date(manualEnd).toISOString(),
          category: category.trim() || null,
          note: note.trim() || null,
        },
        { now: () => new Date().toISOString() },
      );
      await desktopApi.saveFocusSession(session);
      setManualStart("");
      setManualEnd("");
      await load();
    } catch {
      setMessage(t("focus.manualFailed"));
    }
  };

  const storeGoal = async () => {
    const timestamp = new Date().toISOString();
    try {
      const saved = await desktopApi.saveFocusGoal({
        id: ownerId,
        ownerId,
        schemaVersion: 1,
        timezone,
        dailyMinutes: Math.max(0, Math.trunc(dailyGoal)),
        weeklyMinutes: Math.max(0, Math.trunc(weeklyGoal)),
        effectiveFromDate: timestamp.slice(0, 10),
        streakVisible: false,
        revision: goal?.revision ?? 0,
        createdAt: goal?.createdAt ?? timestamp,
        updatedAt: timestamp,
        deletedAt: null,
        updatedByDeviceId: "desktop",
      });
      setGoal(saved);
      setMessage(t("focus.goalSaved"));
    } catch {
      setMessage(t("focus.goalFailed"));
    }
  };

  const completed = sessions.filter((session) => session.status === "completed");
  const summary = useMemo(() => aggregateFocusSessions(completed, timezone), [completed, timezone]);
  const progress = goal
    ? focusGoalProgress(completed, goal, new Date().toISOString().slice(0, 10))
    : null;
  const seconds = active
    ? (remainingFocusSeconds(active, now) ?? elapsedFocusSeconds(active, now))
    : 0;

  return (
    <section className="focus-workspace" aria-labelledby="focus-heading">
      <div className="focus-heading">
        <div>
          <p className="eyebrow">{t("focus.title").toLocaleUpperCase()}</p>
          <h2 id="focus-heading">{t("focus.subtitle")}</h2>
        </div>
        <p className="hint">{t("focus.inAppNotice")}</p>
      </div>
      {message && (
        <div className="toast" role="status">
          {message}
        </div>
      )}
      <div className="focus-grid">
        <article className="settings-card focus-timer-card">
          {active ? (
            <>
              <p className="eyebrow">
                {t(`focus.${active.mode}`)} · {t(`focus.${active.status}`)}
              </p>
              <output
                className="focus-timer"
                aria-label={t("focus.timerA11y", {
                  mode: t(`focus.${active.mode}`),
                  state: t(`focus.${active.status}`),
                  duration: timerText(seconds),
                })}
              >
                {timerText(seconds)}
              </output>
              <div className="focus-actions">
                {active.status === "running" ? (
                  <button
                    className="primary-button"
                    onClick={() =>
                      void save(pauseFocusSession(active, { now: () => new Date().toISOString() }))
                    }
                  >
                    {t("focus.pause")}
                  </button>
                ) : (
                  <button
                    className="primary-button"
                    onClick={() =>
                      void save(resumeFocusSession(active, { now: () => new Date().toISOString() }))
                    }
                  >
                    {t("focus.resume")}
                  </button>
                )}
                <button
                  className="secondary-button"
                  onClick={() =>
                    void save(finishFocusSession(active, { now: () => new Date().toISOString() }))
                  }
                >
                  {t("focus.finish")}
                </button>
                <button
                  className="text-button"
                  onClick={() => {
                    if (
                      window.confirm(
                        `${t("focus.confirmCancel")}\n${t("focus.confirmCancelDetail")}`,
                      )
                    )
                      void save(
                        cancelFocusSession(active, { now: () => new Date().toISOString() }),
                      );
                  }}
                >
                  {t("focus.cancel")}
                </button>
              </div>
            </>
          ) : (
            <>
              <h3>{t("focus.noActive")}</h3>
              <div className="segmented" role="group" aria-label={t("focus.title")}>
                {modes.map((value) => (
                  <button
                    key={value}
                    className={mode === value ? "active" : ""}
                    onClick={() => {
                      setMode(value);
                      if (value === "pomodoro") setMinutes(25);
                    }}
                  >
                    {t(`focus.${value}`)}
                  </button>
                ))}
              </div>
              {mode !== "stopwatch" && (
                <label>
                  {t("focus.presets")}
                  <select
                    value={minutes}
                    onChange={(event) => setMinutes(Number(event.target.value))}
                  >
                    {presets.map((value) => (
                      <option value={value} key={value}>
                        {formatDuration(locale, value)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                {t("focus.category")}
                <input value={category} onChange={(event) => setCategory(event.target.value)} />
              </label>
              <label>
                {t("focus.sessionNote")}
                <textarea value={note} onChange={(event) => setNote(event.target.value)} />
              </label>
              <button className="primary-button" onClick={() => void begin()}>
                {t("focus.start")}
              </button>
            </>
          )}
        </article>

        <article className="settings-card">
          <h3>{t("focus.analytics")}</h3>
          {summary.completedSessions === 0 ? (
            <p>{t("focus.analyticsEmpty")}</p>
          ) : (
            <div className="focus-summary" role="figure" aria-label={t("focus.analytics")}>
              <strong>{t("focus.completedCount", { count: summary.completedSessions })}</strong>
              <span>
                {t("focus.plannedVsActual", {
                  planned: formatDuration(locale, Math.round(summary.plannedSeconds / 60)),
                  actual: formatDuration(locale, Math.round(summary.focusedSeconds / 60)),
                })}
              </span>
              <span>
                {t("focus.average")}:{" "}
                {formatDuration(locale, Math.round(summary.averageSessionSeconds / 60))}
              </span>
              <span>
                {t("focus.breakTime", {
                  duration: formatDuration(locale, Math.round(summary.breakSeconds / 60)),
                })}
              </span>
            </div>
          )}
        </article>

        <article className="settings-card">
          <h3>{t("focus.goals")}</h3>
          {progress && (
            <>
              <p>
                {t("focus.dailyProgress", {
                  actual: formatDuration(locale, Math.round(progress.dailySeconds / 60)),
                  target: formatDuration(locale, Math.round(progress.dailyTargetSeconds / 60)),
                })}
              </p>
              <p>
                {t("focus.weeklyProgress", {
                  actual: formatDuration(locale, Math.round(progress.weeklySeconds / 60)),
                  target: formatDuration(locale, Math.round(progress.weeklyTargetSeconds / 60)),
                })}
              </p>
            </>
          )}
          <label>
            {t("focus.dailyGoal")}
            <input
              type="number"
              min="0"
              max="1440"
              value={dailyGoal}
              onChange={(event) => setDailyGoal(Number(event.target.value))}
            />
          </label>
          <label>
            {t("focus.weeklyGoal")}
            <input
              type="number"
              min="0"
              max="10080"
              value={weeklyGoal}
              onChange={(event) => setWeeklyGoal(Number(event.target.value))}
            />
          </label>
          <button className="secondary-button" onClick={() => void storeGoal()}>
            {t("focus.saveGoals")}
          </button>
          <p className="hint">{t("focus.noStreak")}</p>
        </article>

        <article className="settings-card">
          <h3>{t("focus.manual")}</h3>
          <label>
            {t("focus.manualStart")}
            <input value={manualStart} onChange={(event) => setManualStart(event.target.value)} />
          </label>
          <label>
            {t("focus.manualEnd")}
            <input value={manualEnd} onChange={(event) => setManualEnd(event.target.value)} />
          </label>
          <button
            className="secondary-button"
            disabled={!manualStart || !manualEnd}
            onClick={() => void addManual()}
          >
            {t("focus.addManual")}
          </button>
        </article>
      </div>

      <section className="today-card">
        <h3>{t("focus.recent")}</h3>
        {completed.length === 0 ? <p>{t("focus.noHistory")}</p> : null}
        <div className="today-list">
          {completed.slice(0, 20).map((session) => (
            <div className="focus-history-row" key={session.id}>
              <strong>{t(`focus.${session.mode}`)}</strong>
              <span>
                {formatInstant(locale, session.startedAt, timezone)} ·{" "}
                {formatDuration(locale, Math.max(1, Math.round(session.actualFocusSeconds / 60)))}
              </span>
              {session.category && <span>{session.category}</span>}
            </div>
          ))}
        </div>
      </section>
    </section>
  );
}

function timerText(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3_600);
  const minutes = Math.floor((safe % 3_600) / 60);
  const remainder = safe % 60;
  return hours
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}
