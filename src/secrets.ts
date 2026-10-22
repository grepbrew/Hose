import { invoke, isTauri } from "@tauri-apps/api/core";

export type Keys = { runpod: string; hf: string; vllm: string };
const EMPTY: Keys = { runpod: "", hf: "", vllm: "" };

// All keys live in ONE Keychain item, read once per launch: macOS asks for Keychain access per item,
// so one item means at most one prompt. Outside Tauri (vite dev / screen tests) it falls back to localStorage.
const ITEM = "keys";
const LEGACY = ["runpod", "hf", "vllm"] as const; // one item per key, written by builds before 2026-10-22

const read = async (name: string): Promise<string> =>
  isTauri() ? ((await invoke<string | null>("secret_get", { name })) ?? "") : (localStorage.getItem(`hose.${name}`) ?? "");
const write = async (name: string, value: string) =>
  isTauri() ? invoke("secret_set", { name, value }) : localStorage.setItem(`hose.${name}`, value);
const remove = async (name: string) => (isTauri() ? invoke("secret_delete", { name }) : localStorage.removeItem(`hose.${name}`));

export const saveKeys = (keys: Keys) => write(ITEM, JSON.stringify(keys));

export async function loadKeys(): Promise<Keys> {
  const raw = await read(ITEM);
  if (raw) return { ...EMPTY, ...JSON.parse(raw) };
  const keys = { ...EMPTY };
  for (const name of LEGACY) keys[name] = await read(name);
  if (keys.runpod || keys.hf || keys.vllm) {
    await saveKeys(keys);
    for (const name of LEGACY) await remove(name);
  }
  return keys;
}
