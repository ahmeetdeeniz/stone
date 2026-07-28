import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const workspaceRoot = path.resolve(import.meta.dirname, "..");
const trackedFiles = runGit(["ls-files", "--cached", "--others", "--exclude-standard", "-z"])
  .split("\0")
  .filter(Boolean);
const markdownFiles = trackedFiles.filter(
  (file) =>
    file.endsWith(".md") &&
    !file.startsWith("packages/markdown/fixtures/") &&
    !file.startsWith("docs/"),
);

const failures = [];
for (const file of markdownFiles) {
  const source = readFileSync(path.join(workspaceRoot, file), "utf8");
  const links = source.matchAll(/(?<!!)\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/gu);
  for (const match of links) {
    const href = match[1];
    if (
      href.startsWith("#") ||
      href.startsWith("https://") ||
      href.startsWith("http://") ||
      href.startsWith("mailto:")
    ) {
      continue;
    }
    const [pathname] = href.split("#", 1);
    const target = path.resolve(workspaceRoot, path.dirname(file), decodeURIComponent(pathname));
    if (!existsSync(target)) failures.push(`${file}: missing local link target ${href}`);
  }
}

if (failures.length > 0) {
  throw new Error(`Public documentation link failures:\n${failures.join("\n")}`);
}

console.log(`Public documentation links verified across ${markdownFiles.length} tracked files.`);

function runGit(args) {
  const result = spawnSync("git", args, { cwd: workspaceRoot, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "git failed.");
  return result.stdout;
}
