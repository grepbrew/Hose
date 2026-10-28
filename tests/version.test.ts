import { describe, it, expect } from "vitest";
import pkg from "../package.json";
import lock from "../package-lock.json";
import conf from "../src-tauri/tauri.conf.json";
import CARGO from "../src-tauri/Cargo.toml?raw";
import CARGO_LOCK from "../src-tauri/Cargo.lock?raw";
import README from "../README.md?raw";
import RELEASE from "../.github/workflows/release.yml?raw";
import HISTORY from "../src/history.ts?raw";

const SCREEN: Record<string, string> = import.meta.glob("./screen/*.mjs", { query: "?raw", import: "default", eager: true });

// The release tag must match tauri.conf.json (it names the DMG the cask points at), and every PR bumps all five.
describe("versions", () => {
  it("all five manifests match", () => {
    const versions = [
      lock.version,
      lock.packages[""].version,
      conf.version,
      CARGO.match(/^version = "(.+)"/m)?.[1],
      CARGO_LOCK.match(/^name = "hose"\nversion = "(.+)"/m)?.[1],
    ];

    expect(versions).toEqual(Array(5).fill(pkg.version));
  });
});

// The app's data folders are named after the bundle id, so README paths and the cask's zap list must follow it.
describe("bundle id", () => {
  it("docs and cask use the app's identifier", () => {
    const ids = [README, RELEASE, HISTORY].flatMap((s) => s.match(/com\.[a-z]+\.hose/g) ?? []);

    expect(conf.identifier).toBe("com.grepbrew.hose");
    expect(new Set(ids)).toEqual(new Set([conf.identifier]));
  });

  it("screen tests name no home folder", () => {
    const named = Object.keys(SCREEN).filter((f) => /\/Users\/[^/]+\//.test(SCREEN[f]));

    expect(named).toEqual([]);
  });
});
