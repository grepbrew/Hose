// Every network call. Inside the app requests go through Tauri's Rust HTTP client (RunPod's
// management API blocks browser CORS); in vite dev / tests plain fetch is used and msw answers.
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { isTauri } from "@tauri-apps/api/core";
import { sseText, type Cloud, type Gpu, type HfInfo } from "./cost";

const REST = "https://api.runpod.io/v2";
const GQL = "https://api.runpod.io/graphql";
const HF = "https://huggingface.co";

const http: typeof fetch = (input, init) => (isTauri() ? tauriFetch(input, init) : fetch(input, init));

async function runpod<T>(url: string, key: string, init: RequestInit = {}): Promise<T> {
  const res = await http(url, {
    ...init,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
  });
  if (res.status === 401 || res.status === 403) throw new Error("RunPod rejected this key");
  if (!res.ok) throw new Error(`RunPod error ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

async function gql<T>(key: string, query: string, variables?: object): Promise<T> {
  const r = await runpod<{ data: T; errors?: { message: string }[] }>(GQL, key, {
    method: "POST",
    body: JSON.stringify({ query, variables }),
  });
  if (r.errors?.length) throw new Error(r.errors[0].message);
  return r.data;
}

// --- account ---------------------------------------------------------------

export async function getBalance(key: string): Promise<number> {
  const { myself } = await gql<{ myself: { clientBalance: number } | null }>(key, "{ myself { clientBalance } }");
  if (!myself) throw new Error("RunPod rejected this key");
  return myself.clientBalance;
}

export const getGpus = (key: string, cloud: Cloud) =>
  runpod<{ gpus: Gpu[] }>(`${REST}/catalog/gpus?include=AVAILABILITY&product=POD&cloud=${cloud}&minCudaVersion=13.0`, key).then((r) => r.gpus);

// --- pods ------------------------------------------------------------------

export type Pod = { id: string; name: string; status: string; cost: number; createdAt?: string };

// ponytail: first page only (default page size); fine while people run a handful of pods
export const listHosePods = (key: string) =>
  runpod<{ pods: Pod[] }>(`${REST}/pods`, key).then((r) => r.pods.filter((p) => p.name.startsWith("hose-")));

export const createPod = (key: string, input: object) => runpod<Pod>(`${REST}/pods`, key, { method: "POST", body: JSON.stringify(input) });

export const deletePod = (key: string, id: string) => runpod<void>(`${REST}/pods/${id}`, key, { method: "DELETE" });

// --- chat (vLLM on the pod, through RunPod's public proxy, guarded by vLLM's --api-key) ---------------

const podUrl = (id: string) => `https://${id}-8000.proxy.runpod.net`;

/** vLLM answers /v1/models once the model is loaded; before that the proxy returns 404/502. */
export async function podReady(id: string, apiKey: string): Promise<boolean> {
  try {
    return (await http(`${podUrl(id)}/v1/models`, { headers: { Authorization: `Bearer ${apiKey}` } })).ok;
  } catch {
    return false;
  }
}

export type Message = { role: "user" | "assistant"; content: string };

/** Streams the reply; onText gets the whole text so far after every chunk. Resolves with the full reply. */
export async function chatStream(id: string, apiKey: string, model: string, messages: Message[], onText: (text: string) => void) {
  const res = await http(`${podUrl(id)}/v1/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    // enable_thinking off: Qwen3 would otherwise stream its raw <think> notes; other models' templates ignore it
    body: JSON.stringify({ model, messages, stream: true, max_tokens: 1024, temperature: 0.7, chat_template_kwargs: { enable_thinking: false } }),
  });
  if (!res.ok || !res.body) throw new Error(`The model answered with error ${res.status}`);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let raw = "";
  for (let r = await reader.read(); !r.done; r = await reader.read()) {
    raw += r.value;
    onText(sseText(raw.slice(0, raw.lastIndexOf("\n") + 1))); // only complete lines parse
  }
  const text = sseText(raw);
  onText(text);
  return text;
}

// --- Hugging Face ------------------------------------------------------------

const hfHeaders = (token: string): HeadersInit => (token ? { Authorization: `Bearer ${token}` } : {});

export async function hfWhoami(token: string): Promise<string> {
  const res = await http(`${HF}/api/whoami-v2`, { headers: hfHeaders(token) });
  if (!res.ok) throw new Error("Hugging Face rejected this token");
  return (await res.json()).name;
}

export async function hfModelInfo(id: string, token: string): Promise<HfInfo> {
  const q = ["pipeline_tag", "gated", "safetensors"].map((f) => `expand[]=${f}`).join("&");
  const res = await http(`${HF}/api/models/${id}?${q}`, { headers: hfHeaders(token) });
  if (res.status === 404 || res.status === 401) throw new Error("No model with that name on Hugging Face");
  if (!res.ok) throw new Error(`Hugging Face error ${res.status}`);
  return { ...(await res.json()), id };
}

// Gated models: the token must belong to someone who accepted the licence on the model page.
export async function hfCanDownload(id: string, token: string): Promise<boolean> {
  const res = await http(`${HF}/${id}/resolve/main/config.json`, { method: "HEAD", headers: hfHeaders(token) });
  return res.ok;
}
