// Release helpers for the desktop workflow (.github/workflows/desktop-release.yml).
//
//   node scripts/desktop-release.mjs config            -> writes tauri.<platform>.conf.json
//   node scripts/desktop-release.mjs collect <out>     -> copies installers + .sig, writes .sha256
//   node scripts/desktop-release.mjs manifest <dir>    -> writes <dir>/latest.json for the updater
//
// Secrets never pass through this script: it only learns *whether* a signing key or Apple
// certificate is configured, and only public values (the updater public key, the repository
// name) end up in the generated configuration.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const INSTALLER_PATTERNS = [
  /-setup\.exe$/u,
  /\.msi$/u,
  /\.dmg$/u,
  /\.app\.tar\.gz$/u,
  /\.deb$/u,
  /\.AppImage$/u,
];

/**
 * Updater platform keys served by each signed updater artifact. The updater looks for
 * `<os>-<arch>-<installer>` first, so a .deb install is never "updated" with an AppImage.
 */
const UPDATER_PLATFORMS = [
  { pattern: /-setup\.exe$/u, platforms: ["windows-x86_64", "windows-x86_64-nsis"] },
  // The macOS build is universal, so one archive serves both architectures.
  { pattern: /\.app\.tar\.gz$/u, platforms: ["darwin-aarch64", "darwin-x86_64"] },
  { pattern: /\.AppImage$/u, platforms: ["linux-x86_64", "linux-x86_64-appimage"] },
  { pattern: /\.deb$/u, platforms: ["linux-x86_64-deb"] },
];

/** Tauri merges this file over tauri.conf.json when building on that platform. */
export function platformConfigFile(platform) {
  if (!["windows", "macos", "linux"].includes(platform)) {
    throw new Error(`Unknown release platform: ${platform}`);
  }
  return `apps/desktop/src-tauri/tauri.${platform}.conf.json`;
}

/**
 * Tauri configuration merged into tauri.conf.json for a release build. The updater is only
 * enabled when a signing key exists, so forks and local builds keep working without one.
 */
export function releaseTauriConfig({
  platform,
  hasUpdaterKey,
  updaterPubkey,
  repository,
  hasAppleCertificate,
}) {
  const config = {};
  if (hasUpdaterKey) {
    if (!updaterPubkey?.trim()) {
      throw new Error(
        "TAURI_SIGNING_PRIVATE_KEY is set but the TAURI_UPDATER_PUBKEY repository variable is " +
          "missing. Add the public key generated with the private key, or updates cannot be verified.",
      );
    }
    if (!repository) throw new Error("GITHUB_REPOSITORY is required to point the updater.");
    config.bundle = { createUpdaterArtifacts: true };
    config.plugins = {
      updater: {
        pubkey: updaterPubkey.trim(),
        endpoints: [`https://github.com/${repository}/releases/latest/download/latest.json`],
        windows: { installMode: "passive" },
      },
    };
  }
  if (platform === "macos" && !hasAppleCertificate) {
    // Ad-hoc signing: without any signature Apple Silicon refuses to launch the app at all.
    config.bundle = { ...config.bundle, macOS: { signingIdentity: "-" } };
  }
  return config;
}

/** A tag build must ship exactly the version in tauri.conf.json, or the updater misfires. */
export function assertTagMatchesVersion(tag, version) {
  if (tag !== `v${version}`) {
    throw new Error(
      `Tag ${tag} does not match apps/desktop/src-tauri/tauri.conf.json version ${version}; ` +
        `bump the version or tag v${version}.`,
    );
  }
}

export function isInstaller(name) {
  return INSTALLER_PATTERNS.some((pattern) => pattern.test(name));
}

/** The updater's `latest.json`, built from signed updater artifacts (`{ name, signature }`). */
export function buildUpdateManifest({ version, notes, pubDate, downloadBase, files }) {
  const platforms = {};
  for (const file of files) {
    const match = UPDATER_PLATFORMS.find(({ pattern }) => pattern.test(file.name));
    if (!match) continue;
    for (const platform of match.platforms) {
      if (platforms[platform]) {
        throw new Error(`Two updater artifacts claim ${platform}: ${file.name}`);
      }
      platforms[platform] = {
        signature: file.signature.trim(),
        url: `${downloadBase}/${encodeURIComponent(file.name)}`,
      };
    }
  }
  if (Object.keys(platforms).length === 0) {
    throw new Error("No signed updater artifacts were found.");
  }
  return { version, notes, pub_date: pubDate, platforms };
}

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    // `.app` bundles are directories; their archived `.app.tar.gz` is what gets shipped.
    if (entry.isDirectory()) return entry.name.endsWith(".app") ? [] : walk(full);
    return [full];
  });
}

function tauriVersion(root) {
  const config = JSON.parse(
    fs.readFileSync(path.join(root, "apps/desktop/src-tauri/tauri.conf.json"), "utf8"),
  );
  return config.version;
}

function configCommand(root, env) {
  const version = tauriVersion(root);
  if (env.GITHUB_REF_TYPE === "tag") assertTagMatchesVersion(env.GITHUB_REF_NAME, version);
  const config = releaseTauriConfig({
    platform: env.RELEASE_PLATFORM,
    hasUpdaterKey: env.HAS_UPDATER_KEY === "true",
    updaterPubkey: env.TAURI_UPDATER_PUBKEY,
    repository: env.GITHUB_REPOSITORY,
    hasAppleCertificate: env.HAS_APPLE_CERTIFICATE === "true",
  });
  console.log(`Desktop ${version} release configuration (secret values are never printed):`);
  console.log(`  updater artifacts: ${config.plugins?.updater ? "signed" : "disabled (no key)"}`);
  if (env.RELEASE_PLATFORM === "macos") {
    console.log(
      `  macOS signing: ${env.HAS_APPLE_CERTIFICATE === "true" ? "Developer ID" : "ad-hoc"}`,
    );
  }
  // A platform config file rather than the TAURI_CONFIG variable: the CLI only forwards that
  // variable to the Rust build, so bundle settings such as createUpdaterArtifacts in it are
  // silently ignored. The generated file is gitignored.
  if (Object.keys(config).length > 0) {
    fs.writeFileSync(
      path.join(root, platformConfigFile(env.RELEASE_PLATFORM)),
      `${JSON.stringify(config, null, 2)}\n`,
    );
  }
}

function collectCommand(root, outDirectory) {
  const out = path.resolve(root, outDirectory);
  fs.mkdirSync(out, { recursive: true });
  const target = path.join(root, "apps/desktop/src-tauri/target");
  const bundles = walk(target).filter((file) => file.includes(`${path.sep}bundle${path.sep}`));
  let copied = 0;
  for (const file of bundles) {
    const name = path.basename(file);
    const installer = isInstaller(name);
    const signature = name.endsWith(".sig") && isInstaller(name.slice(0, -".sig".length));
    if (!installer && !signature) continue;
    fs.copyFileSync(file, path.join(out, name));
    if (installer) {
      const hash = createHash("sha256").update(fs.readFileSync(file)).digest("hex");
      fs.writeFileSync(path.join(out, `${name}.sha256`), `${hash}  ${name}`);
      copied += 1;
    }
  }
  if (copied === 0) throw new Error(`No desktop installers were produced under ${target}.`);
  console.log(`Collected ${copied} installer(s) into ${out}.`);
}

function manifestCommand(root, directory, env) {
  const dir = path.resolve(root, directory);
  const files = fs
    .readdirSync(dir)
    .filter((name) => fs.existsSync(path.join(dir, `${name}.sig`)))
    .map((name) => ({ name, signature: fs.readFileSync(path.join(dir, `${name}.sig`), "utf8") }));
  if (files.length === 0) {
    console.log("No updater signatures found; skipping latest.json (updates stay disabled).");
    return;
  }
  const tag = env.GITHUB_REF_NAME;
  const manifest = buildUpdateManifest({
    version: tauriVersion(root),
    notes: `Stone ${tag}`,
    pubDate: new Date().toISOString(),
    downloadBase: `https://github.com/${env.GITHUB_REPOSITORY}/releases/download/${tag}`,
    files,
  });
  fs.writeFileSync(path.join(dir, "latest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`latest.json covers: ${Object.keys(manifest.platforms).join(", ")}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [command, argument] = process.argv.slice(2);
  const root = process.cwd();
  if (command === "config") configCommand(root, process.env);
  else if (command === "collect") collectCommand(root, argument ?? "release-out");
  else if (command === "manifest") manifestCommand(root, argument ?? "release-assets", process.env);
  else {
    console.error("Usage: desktop-release.mjs <config|collect <out>|manifest <dir>>");
    process.exit(1);
  }
}
