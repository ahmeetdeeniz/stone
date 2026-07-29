import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { withSyntheticFirebaseNativeConfig } from "./firebase-native-verification.mjs";

const workspaceRoot = path.resolve(import.meta.dirname, "..");
const mobileRoot = path.join(workspaceRoot, "apps", "mobile");
const androidRoot = path.join(mobileRoot, "android");
const appConfig = JSON.parse(readFileSync(path.join(mobileRoot, "app.json"), "utf8")).expo;
const backupRoot = mkdtempSync(path.join(os.tmpdir(), "stone-android-compile-backup-"));
const backupAndroidRoot = path.join(backupRoot, "android");
const hadExistingAndroidRoot = existsSync(androidRoot);

try {
  if (hadExistingAndroidRoot) renameSync(androidRoot, backupAndroidRoot);
  withSyntheticFirebaseNativeConfig(
    {
      androidPackage: appConfig.android?.package,
      iosBundleIdentifier: appConfig.ios?.bundleIdentifier,
    },
    ({ environment }) => {
      run(
        pnpmCommand(),
        ["exec", "expo", "prebuild", "--platform", "android", "--clean", "--no-install"],
        mobileRoot,
        environment,
      );
      run(
        process.platform === "win32" ? ".\\gradlew.bat" : "./gradlew",
        [":stone-native-widgets:compileDebugKotlin"],
        androidRoot,
        environment,
      );
    },
  );
} finally {
  if (existsSync(androidRoot)) rmSync(androidRoot, { recursive: true, force: true });
  if (hadExistingAndroidRoot && existsSync(backupAndroidRoot)) {
    renameSync(backupAndroidRoot, androidRoot);
  }
  rmSync(backupRoot, { recursive: true, force: true });
}

console.log("Android widget Kotlin compilation verified with temporary Firebase config.");

function pnpmCommand() {
  return process.platform === "win32" ? "pnpm.cmd" : "pnpm";
}

function run(command, args, cwd, environment) {
  const options = {
    cwd,
    env: { ...process.env, ...environment },
    encoding: "utf8",
    stdio: "inherit",
  };
  const result =
    process.platform === "win32"
      ? spawnSync(
          process.env.ComSpec ?? "cmd.exe",
          ["/d", "/s", "/c", [command, ...args].join(" ")],
          options,
        )
      : spawnSync(command, args, options);
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with code ${result.status}.`);
  }
}
