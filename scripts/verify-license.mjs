import { readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const workspaceRoot = path.resolve(import.meta.dirname, "..");
const expectedCopyright = "Copyright (c) 2026 ahmeetdeeniz";
const license = readFileSync(path.join(workspaceRoot, "LICENSE"), "utf8");
assert(
  license.startsWith("Mozilla Public License Version 2.0\n"),
  "Root LICENSE is not the canonical MPL-2.0 form.",
);
assert(license.includes(expectedCopyright), "Root LICENSE has the wrong copyright notice.");
assert(
  license.includes("2. License Grants and Conditions"),
  "Root LICENSE is missing the MPL-2.0 license grants.",
);
assert(
  license.includes("3. Responsibilities"),
  "Root LICENSE is missing the MPL-2.0 responsibilities.",
);
assert(
  license.includes("Exhibit A - Source Code Form License Notice"),
  "Root LICENSE is missing the MPL-2.0 source notice.",
);

const packageFiles = runGit(["ls-files", "package.json", "*/package.json", "*/*/package.json"])
  .split(/\r?\n/u)
  .filter(Boolean);
const inconsistentPackages = packageFiles.filter((file) => {
  const manifest = JSON.parse(readFileSync(path.join(workspaceRoot, file), "utf8"));
  return manifest.license !== "MPL-2.0";
});
assert(
  inconsistentPackages.length === 0,
  `Package manifests without MPL-2.0 identifier:\n${inconsistentPackages.join("\n")}`,
);

const publicMarkdown = runGit(["ls-files", "*.md"]).split(/\r?\n/u).filter(Boolean);
const conflicts = publicMarkdown.filter((file) => {
  const source = readFileSync(path.join(workspaceRoot, file), "utf8");
  return /no (?:open-source |software )?license|license (?:is )?(?:absent|unresolved)|not licensed/iu.test(
    source,
  );
});
assert(
  conflicts.length === 0,
  `Public documents contain conflicting license claims:\n${conflicts}`,
);

console.log(`MPL-2.0 license verified across ${packageFiles.length} package manifests.`);

function runGit(args) {
  const result = spawnSync("git", args, { cwd: workspaceRoot, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "git failed.");
  return result.stdout;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
