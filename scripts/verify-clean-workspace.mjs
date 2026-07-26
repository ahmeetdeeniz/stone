// Deterministic clean-workspace verification.
//
// Reproduces exactly what a fresh CI checkout sees: no generated dist/target/tsbuildinfo
// output anywhere, so dependency-order problems between @stone/* workspace packages (a
// consumer's tsc resolving another package's compiled output before that package has ever
// been built) cannot hide behind stale local artifacts. This is what caught the
// services/mcp -> @stone/domain TS7016 failure that only reproduced on a clean checkout.
//
// Steps:
//   1. remove all generated dist/target/tsbuildinfo output (never touches node_modules);
//   2. pnpm install --frozen-lockfile;
//   3. build every internal @stone/* package's declarations explicitly;
//   4. run the root typecheck, which now also exercises each consumer's own TypeScript
//      project references (services/mcp, and every packages/* package already using
//      `tsc -b`), so it does not merely depend on step 3 having run in the right order.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function removeGeneratedOutputs(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "dist" || entry.name === "target") {
        console.log(`  removing ${path.relative(root, full)}`);
        fs.rmSync(full, { recursive: true, force: true });
        continue;
      }
      removeGeneratedOutputs(full);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".tsbuildinfo")) {
      console.log(`  removing ${path.relative(root, full)}`);
      fs.rmSync(full, { force: true });
    }
  }
}

// All arguments passed to `run` are hardcoded literals below (never external/untrusted
// input), so joining them into a single command string for the shell is safe. Passing a
// single string (rather than shell:true plus an args array) also avoids Node's
// unsafe-argument-concatenation deprecation warning (DEP0190), since pnpm's Windows shim is
// a .cmd file that cannot be spawned without a shell.
function run(command, args) {
  const line = [command, ...args].join(" ");
  console.log(`\n$ ${line}`);
  const result = spawnSync(line, {
    stdio: "inherit",
    cwd: root,
    shell: true,
  });
  if (result.status !== 0) {
    throw new Error(`Command failed (${result.status}): ${line}`);
  }
}

console.log("Step 1/4: removing generated dist/target/tsbuildinfo output");
removeGeneratedOutputs(root);

console.log("\nStep 2/4: pnpm install --frozen-lockfile");
run("pnpm", ["install", "--frozen-lockfile"]);

console.log("\nStep 3/4: building internal @stone/* package declarations");
run("pnpm", [
  "--filter",
  "@stone/domain",
  "--filter",
  "@stone/markdown",
  "--filter",
  "@stone/editor",
  "--filter",
  "@stone/sync",
  "--filter",
  "@stone/ink",
  "run",
  "typecheck",
]);

console.log("\nStep 4/4: pnpm typecheck (root, exercises every consumer)");
run("pnpm", ["typecheck"]);

console.log(
  "\nClean-workspace verification passed: every workspace package typechecks from a fully clean checkout.",
);
