import { describe, it, expect, vi, beforeEach } from "vitest";

// Boundary double: the webview's localStorage, backed by a Map.
const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
});

const { loadKeys, saveKeys } = await import("../src/secrets");

const KEYS = { runpod: "r1", hf: "h1", vllm: "v1" };

beforeEach(() => store.clear());

describe("loadKeys", () => {
  it("local", async () => {
    store.set("hose.keys", JSON.stringify(KEYS));

    const keys = await loadKeys();

    expect(keys).toEqual(KEYS);
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
  });
});
