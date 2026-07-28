import type { AuthSession } from "./desktop-api";

export type SessionRestoreResult =
  | { status: "authenticated"; session: AuthSession }
  | { status: "signed_out" }
  | { status: "error"; message: string };

export async function restoreDesktopSession(
  restore: () => Promise<AuthSession | null>,
): Promise<SessionRestoreResult> {
  try {
    const session = await restore();
    return session ? { status: "authenticated", session } : { status: "signed_out" };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
