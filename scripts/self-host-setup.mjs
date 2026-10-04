// Self-host setup wizard: `pnpm setup:self-host` (interactive) or
// `pnpm setup:self-host --check` (verify only, exits non-zero when something is missing).
//
// It writes only local, gitignored client configuration (apps/desktop/.env.local and
// .firebaserc), validates the native Firebase files against the app identifiers, and prints the
// remaining console/CLI steps. It never asks for or stores a service account, OAuth secret,
// signing key or password.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const DESKTOP_ENV = "apps/desktop/.env.local";
const FIREBASERC = ".firebaserc";
const ANDROID_CONFIG = "apps/mobile/google-services.json";
const IOS_CONFIG = "apps/mobile/GoogleService-Info.plist";
const APP_JSON = "apps/mobile/app.json";
const TAURI_CONF = "apps/desktop/src-tauri/tauri.conf.json";
export const DEFAULT_APP_ID = "com.imtempra.stone";

/** Firebase project IDs: 6-30 chars, lowercase letters, digits and hyphens. */
export function validateProjectId(value) {
  const id = value.trim();
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/u.test(id)) {
    return "Use the Firebase project ID (6-30 lowercase letters, digits or hyphens), not its display name.";
  }
  return null;
}

/** Firebase Web API keys are public client identifiers that look like `AIza` + 35 characters. */
export function validateWebApiKey(value) {
  return /^AIza[0-9A-Za-z_-]{35}$/u.test(value.trim())
    ? null
    : "A Firebase Web API key starts with AIza and is 39 characters long (Project settings → General → Web app).";
}

export function validateAppId(value) {
  return /^[a-zA-Z][a-zA-Z0-9]*(\.[a-zA-Z][a-zA-Z0-9_]*){2,}$/u.test(value.trim())
    ? null
    : "Use a reverse-DNS identifier such as dev.yourname.stone.";
}

/** GitHub OAuth App client IDs (optional; enables the desktop GitHub integration). */
export function validateGithubClientId(value) {
  if (!value.trim()) return null;
  return /^[A-Za-z0-9._-]{16,40}$/u.test(value.trim())
    ? null
    : "Paste the OAuth App's Client ID (not the client secret).";
}

export function desktopEnvFile({ projectId, apiKey, authDomain, githubClientId }) {
  return [
    "# Written by `pnpm setup:self-host`. Public client identifiers only; never commit this file.",
    `VITE_GITHUB_CLIENT_ID=${githubClientId ?? ""}`,
    `VITE_FIREBASE_API_KEY=${apiKey}`,
    `VITE_FIREBASE_PROJECT_ID=${projectId}`,
    `VITE_FIREBASE_AUTH_DOMAIN=${authDomain || `${projectId}.firebaseapp.com`}`,
    "",
  ].join("\n");
}

export function parseEnvFile(text) {
  const values = {};
  for (const line of text.split(/\r?\n/u)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/u.exec(line);
    if (match) values[match[1]] = match[2];
  }
  return values;
}

function plistString(plist, key) {
  const match = new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`, "u").exec(plist);
  return match ? match[1] : null;
}

/**
 * Checks the native Firebase files against the Firebase project and the app identifiers in
 * app.json. Returns human-readable problems; an empty list means everything matches.
 */
export function checkNativeConfig({
  projectId,
  androidPackage,
  iosBundleId,
  googleServices,
  plist,
}) {
  const problems = [];
  if (googleServices === null) {
    problems.push(`${ANDROID_CONFIG} is missing (Firebase console → Android app → download).`);
  } else {
    let parsed;
    try {
      parsed = JSON.parse(googleServices);
    } catch {
      problems.push(`${ANDROID_CONFIG} is not valid JSON.`);
    }
    if (parsed) {
      const fileProject = parsed.project_info?.project_id;
      if (projectId && fileProject !== projectId) {
        problems.push(`${ANDROID_CONFIG} belongs to project "${fileProject}", not "${projectId}".`);
      }
      const packages = (parsed.client ?? []).map(
        (client) => client.client_info?.android_client_info?.package_name,
      );
      if (!packages.includes(androidPackage)) {
        problems.push(
          `${ANDROID_CONFIG} has no Android app "${androidPackage}" (found: ${packages.join(", ") || "none"}).`,
        );
      }
    }
  }
  // The iOS file is optional: Android-only and desktop-only setups never need it.
  if (plist !== null) {
    const fileProject = plistString(plist, "PROJECT_ID");
    const bundle = plistString(plist, "BUNDLE_ID");
    if (projectId && fileProject !== projectId) {
      problems.push(`${IOS_CONFIG} belongs to project "${fileProject}", not "${projectId}".`);
    }
    if (bundle !== iosBundleId) {
      problems.push(`${IOS_CONFIG} is for bundle "${bundle}", but app.json uses "${iosBundleId}".`);
    }
  }
  return problems;
}

/** Applies a new app identifier to the mobile app (iOS + Android) and the desktop app. */
export function applyAppId(appJson, tauriConf, appId) {
  const nextApp = structuredClone(appJson);
  nextApp.expo.ios = { ...nextApp.expo.ios, bundleIdentifier: appId };
  nextApp.expo.android = { ...nextApp.expo.android, package: appId };
  return { appJson: nextApp, tauriConf: { ...tauriConf, identifier: `${appId}.desktop` } };
}

export function nextSteps({ projectId, nativeProblems }) {
  const steps = [
    "In the Firebase console: Authentication → Sign-in method → enable Email/Password.",
    "Create Firestore (Native mode) and Storage in the same project if you have not yet.",
    `Deploy the security rules and indexes:\n     pnpm exec firebase login\n     pnpm exec firebase deploy --only firestore:rules,firestore:indexes,storage --project ${projectId}`,
  ];
  if (nativeProblems.length > 0) {
    steps.push(
      "Register the Android/iOS apps with the identifiers above, download their config files into apps/mobile/, and run `pnpm setup:self-host --check` again.",
    );
  }
  steps.push(
    "For EAS builds, upload the native files as file environment variables:\n     pnpm --dir apps/mobile exec eas env:create --name GOOGLE_SERVICES_JSON --type file --value ./google-services.json --environment production\n     pnpm --dir apps/mobile exec eas env:create --name GOOGLE_SERVICE_INFO_PLIST --type file --value ./GoogleService-Info.plist --environment production",
    "Start the apps: `pnpm expo` (Development Build) and `pnpm desktop:dev`.",
  );
  return steps;
}

function read(root, file) {
  const full = path.join(root, file);
  return fs.existsSync(full) ? fs.readFileSync(full, "utf8") : null;
}

function readJson(root, file) {
  return JSON.parse(read(root, file));
}

function tool(command, args) {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      shell: process.platform === "win32",
    }).trim();
  } catch {
    return null;
  }
}

function prerequisites() {
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  return [
    { name: "Node.js 22+", ok: nodeMajor >= 22, detail: process.versions.node, required: true },
    { name: "pnpm", ok: Boolean(tool("pnpm", ["--version"])), required: true },
    { name: "Git", ok: Boolean(tool("git", ["--version"])), required: true },
    {
      name: "Java (rules tests, emulators)",
      ok: Boolean(tool("java", ["-version"]) !== null),
      required: false,
    },
    {
      name: "Rust/cargo (desktop builds)",
      ok: Boolean(tool("cargo", ["--version"])),
      required: false,
    },
  ];
}

function parseArgs(argv) {
  const options = { check: false, yes: false, force: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = () => argv[++index] ?? "";
    if (argument === "--check") options.check = true;
    else if (argument === "--yes" || argument === "-y") options.yes = true;
    else if (argument === "--force") options.force = true;
    else if (argument === "--project-id") options.projectId = value();
    else if (argument === "--api-key") options.apiKey = value();
    else if (argument === "--auth-domain") options.authDomain = value();
    else if (argument === "--github-client-id") options.githubClientId = value();
    else if (argument === "--app-id") options.appId = value();
    else throw new Error(`Unknown option: ${argument}`);
  }
  return options;
}

async function ask(rl, question, { initial = "", validate = () => null, yes = false } = {}) {
  if (yes) {
    const problem = validate(initial);
    if (problem) throw new Error(`${question}: ${problem}`);
    return initial.trim();
  }
  for (;;) {
    const suffix = initial ? ` [${initial}]` : "";
    const answer = ((await rl.question(`${question}${suffix}: `)) || initial).trim();
    const problem = validate(answer);
    if (!problem) return answer;
    console.log(`  ✗ ${problem}`);
  }
}

async function confirm(rl, question, yes) {
  if (yes) return true;
  const answer = (await rl.question(`${question} [y/N]: `)).trim().toLowerCase();
  return answer === "y" || answer === "yes" || answer === "e" || answer === "evet";
}

function report(root) {
  const env = parseEnvFile(read(root, DESKTOP_ENV) ?? "");
  const appJson = readJson(root, APP_JSON);
  const projectId = env.VITE_FIREBASE_PROJECT_ID ?? "";
  const problems = [];
  if (!read(root, DESKTOP_ENV)) problems.push(`${DESKTOP_ENV} is missing.`);
  else {
    const projectProblem = validateProjectId(projectId);
    if (projectProblem) problems.push(`VITE_FIREBASE_PROJECT_ID: ${projectProblem}`);
    const keyProblem = validateWebApiKey(env.VITE_FIREBASE_API_KEY ?? "");
    if (keyProblem) problems.push(`VITE_FIREBASE_API_KEY: ${keyProblem}`);
  }
  const nativeProblems = checkNativeConfig({
    projectId,
    androidPackage: appJson.expo.android.package,
    iosBundleId: appJson.expo.ios.bundleIdentifier,
    googleServices: read(root, ANDROID_CONFIG),
    plist: read(root, IOS_CONFIG),
  });
  return { projectId, problems, nativeProblems, appJson };
}

async function main() {
  const root = process.cwd();
  const options = parseArgs(process.argv.slice(2));
  console.log("Stone self-host setup\n");
  const prereqs = prerequisites();
  for (const item of prereqs) {
    const mark = item.ok ? "✓" : item.required ? "✗" : "–";
    console.log(`  ${mark} ${item.name}${item.detail ? ` (${item.detail})` : ""}`);
  }
  const missingRequired = prereqs.some((item) => item.required && !item.ok);

  if (options.check) {
    const { problems, nativeProblems } = report(root);
    console.log("");
    for (const problem of [...problems, ...nativeProblems]) console.log(`  ✗ ${problem}`);
    if (read(root, IOS_CONFIG) === null) console.log(`  – ${IOS_CONFIG} not present (iOS only).`);
    const ok = !missingRequired && problems.length === 0 && nativeProblems.length === 0;
    console.log(ok ? "\nEverything is configured." : "\nRun `pnpm setup:self-host` to fix these.");
    process.exitCode = ok ? 0 : 1;
    return;
  }
  if (missingRequired) throw new Error("Install the required tools above first.");

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const existing = parseEnvFile(read(root, DESKTOP_ENV) ?? "");
    console.log("\nFirebase (Project settings → General → Your apps → Web app):");
    const projectId = await ask(rl, "Firebase project ID", {
      initial: options.projectId ?? existing.VITE_FIREBASE_PROJECT_ID ?? "",
      validate: validateProjectId,
      yes: options.yes,
    });
    const apiKey = await ask(rl, "Web API key", {
      initial: options.apiKey ?? existing.VITE_FIREBASE_API_KEY ?? "",
      validate: validateWebApiKey,
      yes: options.yes,
    });
    const authDomain = await ask(rl, "Auth domain", {
      initial: options.authDomain ?? `${projectId}.firebaseapp.com`,
      validate: (value) =>
        value.includes(".") ? null : "Use the auth domain, e.g. id.firebaseapp.com.",
      yes: options.yes,
    });
    const githubClientId = await ask(rl, "GitHub OAuth App client ID (optional, Enter to skip)", {
      initial: options.githubClientId ?? existing.VITE_GITHUB_CLIENT_ID ?? "",
      validate: validateGithubClientId,
      yes: options.yes,
    });

    const appJson = readJson(root, APP_JSON);
    const currentId = appJson.expo.ios.bundleIdentifier;
    console.log(
      `\nApp identifier: ${currentId}${currentId === DEFAULT_APP_ID ? " (the project default; choose your own so it does not clash in Firebase and the stores)" : ""}`,
    );
    const appId = await ask(rl, "App identifier", {
      initial: options.appId ?? currentId,
      validate: validateAppId,
      yes: options.yes,
    });
    if (appId !== currentId) {
      const next = applyAppId(appJson, readJson(root, TAURI_CONF), appId);
      fs.writeFileSync(path.join(root, APP_JSON), `${JSON.stringify(next.appJson, null, 2)}\n`);
      fs.writeFileSync(path.join(root, TAURI_CONF), `${JSON.stringify(next.tauriConf, null, 2)}\n`);
      // Keep the repository's formatting so `pnpm format:check` stays green.
      tool("pnpm", ["exec", "prettier", "--write", APP_JSON, TAURI_CONF]);
      console.log(`  ✓ Updated ${APP_JSON} and ${TAURI_CONF}`);
    }

    const envText = desktopEnvFile({ projectId, apiKey, authDomain, githubClientId });
    if (
      read(root, DESKTOP_ENV) === null ||
      options.force ||
      (await confirm(rl, `Overwrite ${DESKTOP_ENV}?`, options.yes))
    ) {
      fs.writeFileSync(path.join(root, DESKTOP_ENV), envText);
      console.log(`  ✓ Wrote ${DESKTOP_ENV}`);
    }
    fs.writeFileSync(
      path.join(root, FIREBASERC),
      `${JSON.stringify({ projects: { default: projectId } }, null, 2)}\n`,
    );
    console.log(`  ✓ Wrote ${FIREBASERC}`);

    const { nativeProblems } = report(root);
    console.log("\nNative Firebase files:");
    if (nativeProblems.length === 0) console.log("  ✓ Native config files match.");
    for (const problem of nativeProblems) console.log(`  ✗ ${problem}`);
    if (read(root, IOS_CONFIG) === null) console.log(`  – ${IOS_CONFIG} not present (iOS only).`);

    console.log("\nNext steps:");
    nextSteps({ projectId, nativeProblems }).forEach((step, index) =>
      console.log(`  ${index + 1}. ${step}`),
    );
  } finally {
    rl.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(`\n✗ ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
