// Every network call. Inside the app requests go through Tauri's Rust HTTP client (RunPod's
// management API blocks browser CORS); in vite dev / tests plain fetch is used and msw answers.
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { isTauri } from "@tauri-apps/api/core";
import type { Gpu, HfInfo } from "./cost";

const REST = "https://api.runpod.io/v2";
const GQL = "https://api.runpod.io/graphql";
const RUN = "https://api.runpod.ai/v2";
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

export const getGpus = (key: string) =>
  runpod<{ gpus: Gpu[] }>(`${REST}/catalog/gpus?include=AVAILABILITY&product=SERVERLESS`, key).then((r) => r.gpus);

// --- endpoints -------------------------------------------------------------

export type Endpoint = { id: string; name: string; env?: Record<string, string> };
export type Worker = { id: string; gpuTypeId: string; gpuCount: number; status: string };

export async function listHoseEndpoints(key: string): Promise<Endpoint[]> {
  const { endpoints } = await runpod<{ endpoints: Endpoint[] }>(`${REST}/serverless`, key);
  return endpoints.filter((e) => e.name.startsWith("hose-"));
}

export const createEndpoint = (key: string, input: object) =>
  gql<{ saveEndpoint: Endpoint }>(key, "mutation ($input: EndpointInput!) { saveEndpoint(input: $input) { id name } }", { input }).then(
    (d) => d.saveEndpoint,
  );

export const deleteEndpoint = (key: string, id: string) => runpod<void>(`${REST}/serverless/${id}`, key, { method: "DELETE" });

export const getWorkers = (key: string, id: string) =>
  runpod<{ workers: Worker[] }>(`${REST}/serverless/${id}/workers`, key).then((r) => r.workers);

export async function endpointCostToday(key: string, id: string): Promise<number> {
  const r = await runpod<{ records: { totalAmount: number }[] }>(
    `${REST}/billing/serverless?serverlessId=${id}&bucketSize=day&lastN=1`,
    key,
  );
  return r.records.reduce((sum, rec) => sum + rec.totalAmount, 0);
}

// --- chat (inference host) ------------------------------------------------

export type Message = { role: "user" | "assistant"; content: string };
export type StreamPoll = { status: string; stream: { output: unknown }[] };

export const startChat = (key: string, endpointId: string, messages: Message[]) =>
  runpod<{ id: string }>(`${RUN}/${endpointId}/run`, key, {
    method: "POST",
    body: JSON.stringify({ input: { messages, sampling_params: { max_tokens: 1024, temperature: 0.7 }, stream: true } }),
  }).then((r) => r.id);

export const pollStream = (key: string, endpointId: string, jobId: string) =>
  runpod<StreamPoll>(`${RUN}/${endpointId}/stream/${jobId}`, key);

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
