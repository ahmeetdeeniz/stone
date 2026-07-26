import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const desktop = readJson("apps/desktop/package.json");
const tauri = readJson("apps/desktop/src-tauri/tauri.conf.json");
const rust = fs.readFileSync(path.join(root, "apps/desktop/src-tauri/src/lib.rs"), "utf8");
const build = fs.readFileSync(path.join(root, "apps/desktop/src-tauri/build.rs"), "utf8");
const viteConfig = fs.readFileSync(path.join(root, "apps/desktop/vite.config.ts"), "utf8");
const envExample = fs.readFileSync(path.join(root, "apps/desktop/.env.example"), "utf8");

const requiredDependencies = [
  "@tauri-apps/api",
  "@stone/editor",
  "@stone/markdown",
  "react",
  "react-dom",
];
for (const dependency of requiredDependencies) {
  if (!desktop.dependencies?.[dependency])
    throw new Error(`Desktop dependency missing: ${dependency}`);
}
if (tauri.build?.frontendDist !== "../dist" || !tauri.build?.devUrl) {
  throw new Error("Tauri frontend build wiring is incomplete.");
}
for (const command of [
  "list_documents",
  "save_document",
  "index_folder",
  "save_linked_file",
  "watch_folder",
  "keychain_get",
  "auth_sign_in",
  "auth_restore",
  "auth_password_reset",
  "auth_sign_out",
  "sync_now",
]) {
  if (!rust.includes(command)) throw new Error(`Desktop native command missing: ${command}`);
}
if (!rust.includes("MAX_MARKDOWN_BYTES") || !rust.includes("ExternalEditConflict")) {
  throw new Error("Desktop Markdown safety checks are missing.");
}
if (!build.includes("stone_icon()") || !build.includes("window_icon_path")) {
  throw new Error("Tauri Windows icon build wiring is missing.");
}
if (!/envDir:\s*"\."/.test(viteConfig) || /envDir:\s*"\.\.\/\.\./.test(viteConfig)) {
  throw new Error(
    "Desktop Vite envDir must resolve to the desktop package, not the monorepo root.",
  );
}
for (const key of [
  "VITE_GITHUB_CLIENT_ID",
  "VITE_FIREBASE_API_KEY",
  "VITE_FIREBASE_PROJECT_ID",
  "VITE_FIREBASE_AUTH_DOMAIN",
]) {
  if (!new RegExp(`^${key}=`, "m").test(envExample)) {
    throw new Error(`apps/desktop/.env.example is missing documented key: ${key}`);
  }
}
if (
  tauri.bundle?.icon?.length !== 2 ||
  !tauri.bundle.icon.some((entry) => entry.endsWith(".ico"))
) {
  throw new Error("Tauri bundle icon paths are missing for a valid Windows installer.");
}
if (!tauri.bundle?.targets?.includes("nsis")) {
  throw new Error("Tauri bundle targets must include nsis.");
}
console.log("Desktop Tauri, dependency, storage, keychain, auth and linked-file wiring verified.");
