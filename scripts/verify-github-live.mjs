// Opt-in live GitHub end-to-end verifier for Stone Goal 7.
//
// This orchestrates apps/desktop/src-tauri/tests/github_live.rs, which calls Stone's real
// production GitHub/Git integration code (not a mock) against a disposable repository. It is
// never run automatically: it requires explicit environment configuration and fails SAFELY
// (exit 0, clear message, no partial credential state) whenever that configuration is absent,
// so it can never accidentally run with private credentials in public CI.
//
// Required to actually run live:
//   STONE_LIVE_E2E_REPO=<owner>/stone-goal7-e2e   the disposable private repository to use
//   apps/desktop/.env.local must contain VITE_GITHUB_CLIENT_ID
//
// Each step is a separate `cargo test` process invocation (a real process boundary), so the
// "survives an application restart" assertions in steps 2 and 5 are genuine, not simulated
// in-process. Steps run in order and stop at the first failure. Device Flow authorization
// (step 1) prints a verification URL and user code to the terminal and waits for the operator
// to authorize it in a browser; nothing about the token or device code is ever logged.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();

function readEnvLocal(file) {
  const values = {};
  if (!fs.existsSync(file)) return values;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equals = trimmed.indexOf("=");
    if (equals === -1) continue;
    values[trimmed.slice(0, equals).trim()] = trimmed.slice(equals + 1).trim();
  }
  return values;
}

const desktopEnvLocal = readEnvLocal(path.join(root, "apps/desktop/.env.local"));
const clientId = process.env.VITE_GITHUB_CLIENT_ID || desktopEnvLocal.VITE_GITHUB_CLIENT_ID || "";
const repo = process.env.STONE_LIVE_E2E_REPO || "";

if (!clientId || !repo) {
  console.log(
    "verify:github:live skipped — live GitHub E2E is opt-in and requires explicit configuration:",
  );
  if (!clientId) {
    console.log(
      "  - VITE_GITHUB_CLIENT_ID is not set in apps/desktop/.env.local or the environment.",
    );
  }
  if (!repo) {
    console.log(
      "  - STONE_LIVE_E2E_REPO is not set. Example: STONE_LIVE_E2E_REPO=<your-account>/stone-goal7-e2e",
    );
  }
  console.log(
    "No network request, keychain access, or Git operation was performed. Exiting safely.",
  );
  process.exit(0);
}

const runId = `stone-goal7-e2e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const runRoot = path.join(os.tmpdir(), runId);
const restoreRoot = path.join(runRoot, "root");
const dbPath = path.join(runRoot, "stone-live-e2e.sqlite3");
fs.mkdirSync(restoreRoot, { recursive: true });

console.log(`Live GitHub E2E run: ${runId}`);
console.log(`Disposable repository: ${repo}`);
console.log(`Temporary restore root (outside the Stone source tree): ${restoreRoot}`);

const steps = [
  "live_step1_device_flow_authorizes_and_stores_token",
  "live_step2_status_survives_restart_and_pagination_has_no_duplicates",
  "live_step3_link_repository_accepts_valid_rejects_invalid",
  "live_step4_restore_clone_with_cancel_cleanup_and_retry",
  "live_step5_status_and_pull_after_restart",
  "live_step6_review_commit_push_rejects_unrelated_files",
  "live_step7_verify_remote_commit_via_api",
  "live_step8_failure_handling",
  "live_step9_logout_removes_credential",
];

const childEnv = {
  ...process.env,
  STONE_GITHUB_LIVE_E2E: "1",
  VITE_GITHUB_CLIENT_ID: clientId,
  STONE_LIVE_E2E_REPO: repo,
  STONE_LIVE_E2E_ROOT: restoreRoot,
  STONE_LIVE_E2E_DB: dbPath,
};

let failed = false;
for (const step of steps) {
  console.log(`\n--- ${step} ---`);
  const result = spawnSync(
    "cargo",
    [
      "test",
      "--manifest-path",
      "apps/desktop/src-tauri/Cargo.toml",
      "--test",
      "github_live",
      step,
      "--",
      "--ignored",
      "--nocapture",
      "--test-threads=1",
    ],
    { stdio: "inherit", env: childEnv, cwd: root },
  );
  if (result.status !== 0) {
    console.error(`\nLive GitHub E2E failed at ${step}.`);
    failed = true;
    break;
  }
}

function safeRemove(target) {
  if (!target.startsWith(runRoot)) return;
  fs.rmSync(target, { recursive: true, force: true });
}
safeRemove(restoreRoot);
safeRemove(dbPath);
fs.rmSync(runRoot, { recursive: true, force: true });
console.log(`\nCleaned up disposable local workspace: ${runRoot}`);
console.log(
  "The disposable GitHub repository itself was left untouched except for the reviewed E2E commit/push.",
);

if (failed) {
  process.exit(1);
}
console.log("\nLive GitHub E2E verification passed for all steps.");
