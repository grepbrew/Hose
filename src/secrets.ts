import { invoke, isTauri } from "@tauri-apps/api/core";

export type SecretName = "runpod" | "hf";

// Keychain inside the app. Outside Tauri (vite dev / screen tests) fall back to localStorage.
export const getSecret = async (name: SecretName): Promise<string> =>
  isTauri() ? ((await invoke<string | null>("secret_get", { name })) ?? "") : (localStorage.getItem(`hose.${name}`) ?? "");

export const setSecret = async (name: SecretName, value: string) => {
  if (!value) return deleteSecret(name);
  if (isTauri()) await invoke("secret_set", { name, value });
  else localStorage.setItem(`hose.${name}`, value);
};

export const deleteSecret = async (name: SecretName) => {
  if (isTauri()) await invoke("secret_delete", { name });
  else localStorage.removeItem(`hose.${name}`);
};
