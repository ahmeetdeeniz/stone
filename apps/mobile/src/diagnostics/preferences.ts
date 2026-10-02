/** Crash reporting stays off unless the user explicitly turned it on. */
export function parseCrashReportingPreference(value: string | null | undefined): boolean {
  return value === "on";
}

export type UpdateCheckOutcome = "disabled" | "current" | "downloaded";

/** Short, human-readable form of an EAS update id for the Settings screen. */
export function shortUpdateId(updateId: string | null | undefined): string | null {
  return updateId ? updateId.slice(0, 8) : null;
}
