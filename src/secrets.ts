export type Keys = { runpod: string; hf: string; vllm: string };
const EMPTY: Keys = { runpod: "", hf: "", vllm: "" };

// The keys live in the app's own local storage, one JSON item. The user chose this over the Keychain (2026-10-24):
// an app without an Apple Team ID gets a Keychain password prompt after every rebuild and update. Trade-off: any
// program running as the user can read the file, and backups hold it unencrypted.
const STORE = "hose.keys";

export const saveKeys = async (keys: Keys) => localStorage.setItem(STORE, JSON.stringify(keys));

export async function loadKeys(): Promise<Keys> {
  const raw = localStorage.getItem(STORE);
  return { ...EMPTY, ...(raw ? JSON.parse(raw) : {}) };
}
