import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const workspaceRoot = path.resolve(import.meta.dirname, "..");
const trackedFiles = runGit(["ls-files", "-z"]).split("\0").filter(Boolean);
const forbiddenTracked = trackedFiles.filter((file) => {
  const normalized = file.replaceAll("\\", "/");
  return (
    normalized.startsWith("Icons/") ||
    normalized.toLowerCase().includes("bongita") ||
    normalized.toLowerCase().endsWith(".otf")
  );
});
assert(
  forbiddenTracked.length === 0,
  `Unapproved public assets are tracked:\n${forbiddenTracked.join("\n")}`,
);

const searchableExtensions = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".rs",
  ".toml",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml",
]);
const assetPolicySources = new Set([
  "apps/desktop/src/desktop.test.ts",
  "scripts/verify-public-assets.mjs",
]);
const forbiddenText = [];
for (const file of trackedFiles) {
  if (assetPolicySources.has(file.replaceAll("\\", "/"))) continue;
  if (!searchableExtensions.has(path.extname(file))) continue;
  const source = readFileSync(path.join(workspaceRoot, file), "utf8");
  if (/bongita|(?:^|[/\\])Icons[/\\]/u.test(source)) forbiddenText.push(file);
}
assert(
  forbiddenText.length === 0,
  `Source or public documentation references removed assets:\n${forbiddenText.join("\n")}`,
);

const generatedRoots = ["apps/desktop/dist", "apps/mobile/dist"];
const generatedViolations = [];
for (const relativeRoot of generatedRoots) {
  const root = path.join(workspaceRoot, relativeRoot);
  if (!existsSync(root)) continue;
  for (const file of walk(root)) {
    const relative = path.relative(workspaceRoot, file).replaceAll("\\", "/");
    if (/bongita|(?:^|\/)Icons\//u.test(relative)) generatedViolations.push(relative);
    if (statSync(file).size <= 20 * 1024 * 1024) {
      const bytes = readFileSync(file);
      if (bytes.includes(Buffer.from("Bongita", "utf8"))) generatedViolations.push(relative);
    }
  }
}
assert(
  generatedViolations.length === 0,
  `Generated output contains removed assets:\n${[...new Set(generatedViolations)].join("\n")}`,
);

console.log("Public asset policy verified; generated outputs contain no removed Stone assets.");

function* walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) yield* walk(target);
    else if (entry.isFile()) yield target;
  }
}

function runGit(args) {
  const result = spawnSync("git", args, { cwd: workspaceRoot, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "git failed.");
  return result.stdout;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
