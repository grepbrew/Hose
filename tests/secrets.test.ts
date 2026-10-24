import { describe, it, expect, vi, beforeEach } from "vitest";

// Boundary doubles: the webview's localStorage, and the Tauri IPC to the Rust Keychain commands (older builds kept the
// keys there), each backed by a Map.
const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
});
const keychain = new Map<string, string>();
const invoke = vi.fn(async (cmd: string, args: { name: string }) => {
  if (cmd === "secret_get") return keychain.get(args.name) ?? null;
  if (cmd === "secret_delete") keychain.delete(args.name);
  return null;
});
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: (cmd: string, args: never) => invoke(cmd, args) }));

const { loadKeys, saveKeys } = await import("../src/secrets");

const KEYS = { runpod: "r1", hf: "h1", vllm: "v1" };

beforeEach(() => {
  store.clear();
  keychain.clear();
  invoke.mockClear();
});

describe("loadKeys", () => {
  it("local", async () => {
    store.set("hose.keys", JSON.stringify(KEYS));

    const keys = await loadKeys();

    expect(keys).toEqual(KEYS);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("moves keychain keys once", async () => {
    keychain.set("keys", JSON.stringify(KEYS));

    const first = await loadKeys();
    const callsAfterFirst = invoke.mock.calls.length;
    const second = await loadKeys();

    expect(first).toEqual(KEYS);
    expect(second).toEqual(KEYS);
    expect(JSON.parse(store.get("hose.keys")!)).toEqual(KEYS);
    expect(keychain.has("keys")).toBe(false);
    expect(invoke.mock.calls.length).toBe(callsAfterFirst);
  });

  it("none", async () => {
    const keys = await loadKeys();

    expect(keys).toEqual({ runpod: "", hf: "", vllm: "" });
    expect(store.size).toBe(0);
  });
});

describe("saveKeys", () => {
  it("local storage", async () => {
    await saveKeys({ runpod: "r1", hf: "", vllm: "v1" });

    expect(store.get("hose.keys")).toBe(JSON.stringify({ runpod: "r1", hf: "", vllm: "v1" }));
    expect(invoke).not.toHaveBeenCalled();
  });
});
