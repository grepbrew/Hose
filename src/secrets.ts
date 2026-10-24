import { invoke, isTauri } from "@tauri-apps/api/core";

export type Keys = { runpod: string; hf: string; vllm: string };
const EMPTY: Keys = { runpod: "", hf: "", vllm: "" };

// The keys live in the app's own local storage, one JSON item. The user chose this over the Keychain (2026-10-24):
// an app without an Apple Team ID gets a Keychain password prompt after every rebuild and update. Trade-off: any
// program running as the user can read the file, and backups hold it unencrypted.
const STORE = "hose.keys";

export const saveKeys = async (keys: Keys) => localStorage.setItem(STORE, JSON.stringify(keys));

export async function loadKeys(): Promise<Keys> {
  let raw = localStorage.getItem(STORE);
  // builds before 0.1.3 kept them in the Keychain item `keys`: move them here once (one last prompt), then delete it there
  if (!raw && isTauri()) {
    raw = await invoke<string | null>("secret_get", { name: "keys" });
    if (raw) {
      localStorage.setItem(STORE, raw);
      // ponytail: a failed delete leaves a stale Keychain copy that is never read again; Keychain Access can remove it
      await invoke("secret_delete", { name: "keys" }).catch(() => {});
    }
  }
  return { ...EMPTY, ...(raw ? JSON.parse(raw) : {}) };
}
