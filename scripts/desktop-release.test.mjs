import { describe, expect, it } from "vitest";
import {
  assertTagMatchesVersion,
  buildUpdateManifest,
  isInstaller,
  platformConfigFile,
  releaseTauriConfig,
} from "./desktop-release.mjs";

describe("desktop release configuration", () => {
  it("enables signed updates only when a key exists", () => {
    expect(
      releaseTauriConfig({ platform: "windows", hasUpdaterKey: false, repository: "o/r" }),
    ).toEqual({});
    const config = releaseTauriConfig({
      platform: "linux",
      hasUpdaterKey: true,
      updaterPubkey: " PUBKEY ",
      repository: "o/r",
    });
    expect(config.bundle).toEqual({ createUpdaterArtifacts: true });
    expect(config.plugins.updater).toMatchObject({
      pubkey: "PUBKEY",
      endpoints: ["https://github.com/o/r/releases/latest/download/latest.json"],
    });
  });

  it("refuses a signing key without its public key", () => {
    expect(() =>
      releaseTauriConfig({ platform: "linux", hasUpdaterKey: true, repository: "o/r" }),
    ).toThrow(/TAURI_UPDATER_PUBKEY/u);
  });

  it("ad-hoc signs macOS builds without a Developer ID certificate", () => {
    expect(
      releaseTauriConfig({ platform: "macos", hasUpdaterKey: false, hasAppleCertificate: false }),
    ).toEqual({ bundle: { macOS: { signingIdentity: "-" } } });
    expect(
      releaseTauriConfig({ platform: "macos", hasUpdaterKey: false, hasAppleCertificate: true }),
    ).toEqual({});
  });

  it("requires tags to match the app version", () => {
    expect(() => assertTagMatchesVersion("v0.2.0", "0.2.0")).not.toThrow();
    expect(() => assertTagMatchesVersion("v0.2.1", "0.2.0")).toThrow(/does not match/u);
  });
});

describe("desktop update manifest", () => {
  it("maps signed artifacts to updater platforms", () => {
    const manifest = buildUpdateManifest({
      version: "0.2.0",
      notes: "Stone v0.2.0",
      pubDate: "2026-10-02T00:00:00.000Z",
      downloadBase: "https://github.com/o/r/releases/download/v0.2.0",
      files: [
        { name: "Stone_0.2.0_x64-setup.exe", signature: "sig-win\n" },
        { name: "Stone.app.tar.gz", signature: "sig-mac" },
        { name: "Stone_0.2.0_amd64.AppImage", signature: "sig-linux" },
        { name: "Stone_0.2.0_amd64.deb", signature: "sig-deb" },
        { name: "Stone_0.2.0_universal.dmg", signature: "not an updater artifact" },
      ],
    });
    expect(Object.keys(manifest.platforms).sort()).toEqual([
      "darwin-aarch64",
      "darwin-x86_64",
      "linux-x86_64",
      "linux-x86_64-appimage",
      "linux-x86_64-deb",
      "windows-x86_64",
      "windows-x86_64-nsis",
    ]);
    expect(manifest.platforms["linux-x86_64-deb"].url).toMatch(/\.deb$/u);
    expect(manifest.platforms["windows-x86_64"]).toEqual({
      signature: "sig-win",
      url: "https://github.com/o/r/releases/download/v0.2.0/Stone_0.2.0_x64-setup.exe",
    });
    expect(manifest.platforms["darwin-x86_64"].url).toMatch(/Stone\.app\.tar\.gz$/u);
  });

  it("fails loudly instead of publishing an empty manifest", () => {
    expect(() =>
      buildUpdateManifest({ version: "1", notes: "", pubDate: "", downloadBase: "x", files: [] }),
    ).toThrow(/No signed updater artifacts/u);
  });

  it("writes the per-platform config file Tauri merges", () => {
    expect(platformConfigFile("macos")).toBe("apps/desktop/src-tauri/tauri.macos.conf.json");
    expect(() => platformConfigFile("android")).toThrow(/Unknown release platform/u);
  });

  it("recognises shipped installers only", () => {
    expect(isInstaller("Stone_0.2.0_x64-setup.exe")).toBe(true);
    expect(isInstaller("Stone_0.2.0_universal.dmg")).toBe(true);
    expect(isInstaller("stone-desktop.exe")).toBe(false);
  });
});
