import { readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const workspaceRoot = path.resolve(import.meta.dirname, "..");
const trackedFiles = runGit(["ls-files", "-z"]).split("\0").filter(Boolean);

const privatePrefixes = ["docs/", "goals/"];
const privateFiles = new Set(["AGENTS.md", "PLAN.md", "PROGRESS.md"]);
const sensitiveNames = [
  /^\.env(?:\..+)?$/u,
  /^GoogleService-Info\.plist$/u,
  /^google-services\.json$/u,
  /\.(?:jks|keystore|p8|p12|pem|crt|der|mobileprovision)$/u,
];

const violations = trackedFiles.filter((file) => {
  const normalized = file.replaceAll("\\", "/");
  const basename = path.posix.basename(normalized);
  return (
    privateFiles.has(normalized) ||
    privatePrefixes.some((prefix) => normalized.startsWith(prefix)) ||
    (basename !== ".env.example" && sensitiveNames.some((pattern) => pattern.test(basename)))
  );
});

assert(
  violations.length === 0,
  `Private or credential-bearing files are tracked:\n${violations.join("\n")}`,
);

const readme = readFileSync(path.join(workspaceRoot, "README.md"), "utf8");
const readmePrivateReferences = ["AGENTS.md", "PLAN.md", "PROGRESS.md", "docs/", "goals/"].filter(
  (reference) => readme.includes(reference),
);
assert(
  readmePrivateReferences.length === 0,
  `Public README references private development paths: ${readmePrivateReferences.join(", ")}`,
);

console.log("Public repository boundary verified.");

function runGit(args) {
  const result = spawnSync("git", args, {
    cwd: workspaceRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "git command failed.");
  }
  return result.stdout;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
