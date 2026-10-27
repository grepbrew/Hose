import { describe, it, expect } from "vitest";
import pkg from "../package.json";
import lock from "../package-lock.json";
import conf from "../src-tauri/tauri.conf.json";
import CARGO from "../src-tauri/Cargo.toml?raw";
import CARGO_LOCK from "../src-tauri/Cargo.lock?raw";

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
