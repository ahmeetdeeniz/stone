import { readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const workspaceRoot = path.resolve(import.meta.dirname, "..");
const expectedCopyright = "Copyright (c) 2026 ahmeetdeeniz";
const license = readFileSync(path.join(workspaceRoot, "LICENSE"), "utf8");
assert(license.startsWith("MIT License\n"), "Root LICENSE is not the canonical MIT form.");
assert(license.includes(expectedCopyright), "Root LICENSE has the wrong copyright notice.");
assert(
  license.includes("Permission is hereby granted, free of charge"),
  "Root LICENSE is missing the MIT permission grant.",
);
assert(
  license.includes('THE SOFTWARE IS PROVIDED "AS IS"'),
  "Root LICENSE is missing the MIT warranty disclaimer.",
);

const packageFiles = runGit(["ls-files", "package.json", "*/package.json", "*/*/package.json"])
  .split(/\r?\n/u)
  .filter(Boolean);
const inconsistentPackages = packageFiles.filter((file) => {
  const manifest = JSON.parse(readFileSync(path.join(workspaceRoot, file), "utf8"));
  return manifest.license !== "MIT";
});
assert(
  inconsistentPackages.length === 0,
  `Package manifests without MIT identifier:\n${inconsistentPackages.join("\n")}`,
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

console.log(`MIT license verified across ${packageFiles.length} package manifests.`);

function runGit(args) {
  const result = spawnSync("git", args, { cwd: workspaceRoot, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "git failed.");
  return result.stdout;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
