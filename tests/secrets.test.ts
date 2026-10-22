import { describe, it, expect, vi, beforeEach } from "vitest";

// Boundary double: the Tauri IPC to the Rust Keychain commands, backed by a Map.
const keychain = new Map<string, string>();
const invoke = vi.fn(async (cmd: string, args: { name: string; value?: string }) => {
  if (cmd === "secret_get") return keychain.get(args.name) ?? null;
  if (cmd === "secret_set") keychain.set(args.name, args.value!);
  if (cmd === "secret_delete") keychain.delete(args.name);
  return null;
});
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: (cmd: string, args: never) => invoke(cmd, args) }));

const { loadKeys, saveKeys } = await import("../src/secrets");

beforeEach(() => {
  keychain.clear();
  invoke.mockClear();
});

describe("loadKeys", () => {
  it("one read", async () => {
    keychain.set("keys", JSON.stringify({ runpod: "r1", hf: "h1", vllm: "v1" }));

    const keys = await loadKeys();

    expect(keys).toEqual({ runpod: "r1", hf: "h1", vllm: "v1" });
    expect(invoke.mock.calls.filter(([cmd]) => cmd === "secret_get")).toHaveLength(1);
  });

  it("migrates legacy items", async () => {
    keychain.set("runpod", "r1");
    keychain.set("hf", "h1");

    const keys = await loadKeys();

    expect(keys).toEqual({ runpod: "r1", hf: "h1", vllm: "" });
    expect([...keychain.keys()]).toEqual(["keys"]);
  });
});

describe("saveKeys", () => {
  it("one item", async () => {
    await saveKeys({ runpod: "r1", hf: "", vllm: "v1" });

    expect(Object.fromEntries(keychain)).toEqual({ keys: JSON.stringify({ runpod: "r1", hf: "", vllm: "v1" }) });
  });
});
