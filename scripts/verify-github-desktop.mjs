import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const rust = fs.readFileSync(path.join(root, "apps/desktop/src-tauri/src/lib.rs"), "utf8");
const github = fs.readFileSync(path.join(root, "apps/desktop/src-tauri/src/github.rs"), "utf8");
const git = fs.readFileSync(path.join(root, "apps/desktop/src-tauri/src/git.rs"), "utf8");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

for (const required of [
  "https://github.com/login/device/code",
  "https://github.com/login/oauth/access_token",
  'scope", "repo',
  "DeviceTokenResponse",
  "authorization_pending",
  "access_token: Option",
  "pub async fn repository",
  "/user/repos",
  "X-GitHub-Api-Version",
  'rel=\\"next\\"',
]) {
  if (!github.includes(required))
    throw new Error(`GitHub integration requirement missing: ${required}`);
}
for (const command of [
  "github_device_start",
  "github_device_poll",
  "github_list_repositories",
  "github_link_repository",
  "restore_repositories",
  "restore_disk_check",
  "cancel_restore",
  "git_pull",
  "git_stage_commit_push",
]) {
  if (!rust.includes(command)) throw new Error(`GitHub desktop command missing: ${command}`);
}
for (const forbidden of [
  "reset --hard",
  "git clean",
  "branch -D",
  "--force",
  "rebase",
  "merge --",
]) {
  if (git.includes(forbidden))
    throw new Error(`Forbidden destructive Git operation present: ${forbidden}`);
}
for (const forbiddenExecutable of [
  'Command::new("cmd")',
  'Command::new("powershell")',
  'Command::new("sh")',
  'Command::new("bash")',
]) {
  if (git.includes(forbiddenExecutable) || rust.includes(forbiddenExecutable)) {
    throw new Error(`Shell execution boundary present: ${forbiddenExecutable}`);
  }
}
if (!git.includes("GIT_TERMINAL_PROMPT") || !git.includes("STONE_GITHUB_TOKEN")) {
  throw new Error("Git credential isolation is missing.");
}
for (const safetyBoundary of [
  "pub fn destination_name",
  "cleanup_partial_destination",
  '"diff".to_owned()',
  '"--cached".to_owned()',
]) {
  if (!git.includes(safetyBoundary)) {
    throw new Error(`Git safety boundary missing: ${safetyBoundary}`);
  }
}
if (!rust.includes("github::repository(&input.repository.full_name).await")) {
  throw new Error("Repository link server validation is missing.");
}
if (packageJson.scripts?.["verify:github"] !== "node scripts/verify-github-desktop.mjs") {
  throw new Error("GitHub verification script is not wired at the repository root.");
}
console.log(
  "GitHub OAuth, pagination, secure credential, safe Git and restore boundaries verified.",
);
