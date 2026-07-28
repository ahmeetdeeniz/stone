import type { GitHubAccount } from "./desktop-api";

export type GitHubRestoreResult =
  | { status: "connected"; account: GitHubAccount }
  | { status: "disconnected" }
  | { status: "invalid"; message: string };

export async function restoreGitHubConnection(
  status: () => Promise<GitHubAccount | null>,
): Promise<GitHubRestoreResult> {
  try {
    const account = await status();
    return account ? { status: "connected", account } : { status: "disconnected" };
  } catch (error) {
    return {
      status: "invalid",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
