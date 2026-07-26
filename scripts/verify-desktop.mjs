import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const desktop = readJson("apps/desktop/package.json");
const tauri = readJson("apps/desktop/src-tauri/tauri.conf.json");
const rust = fs.readFileSync(path.join(root, "apps/desktop/src-tauri/src/lib.rs"), "utf8");

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
console.log("Desktop Tauri, dependency, storage, keychain, auth and linked-file wiring verified.");
