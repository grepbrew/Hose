// Every network call. Inside the app requests go through Tauri's Rust HTTP client (RunPod's
// management API blocks browser CORS); in vite dev / tests plain fetch is used and msw answers.
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { isTauri } from "@tauri-apps/api/core";
import { sseData, sseReply, replyStats, vllmLoad, logText, placeName, parseHfModel, thinks, type Cloud, type DataCenter, type DrawParams, type Gpu, type HfInfo, type Pod } from "./cost";

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

// ponytail: one catalog fetch per key and cloud a minute, shared by the quick start, the model list and the GPU
// picker; stock shown may be up to 60 s old
const gpuCache = new Map<string, { at: number; gpus: Promise<Gpu[]> }>();
export function getGpus(key: string, cloud: Cloud): Promise<Gpu[]> {
  const hit = gpuCache.get(key + cloud);
  if (hit && Date.now() - hit.at < 60000) return hit.gpus;
  const gpus = runpod<{ gpus: Gpu[] }>(`${REST}/catalog/gpus?include=AVAILABILITY&product=POD&cloud=${cloud}&minCudaVersion=13.0`, key).then((r) => r.gpus);
  gpus.catch(() => gpuCache.delete(key + cloud)); // try again next time
  gpuCache.set(key + cloud, { at: Date.now(), gpus });
  return gpus;
}

// --- pods ------------------------------------------------------------------

export type { Pod };

// ponytail: first page only (default page size); fine while people run a handful of pods
export const listHosePods = (key: string) =>
  runpod<{ pods: Pod[] }>(`${REST}/pods`, key).then((r) => r.pods.filter((p) => p.name.startsWith("hose-")));

export const createPod = (key: string, input: object) => runpod<Pod>(`${REST}/pods`, key, { method: "POST", body: JSON.stringify(input) });

export const deletePod = (key: string, id: string) => runpod<void>(`${REST}/pods/${id}`, key, { method: "DELETE" });

// --- network volumes: keep a model between pods (one data center, billed until deleted) -------------

export type Volume = { id: string; name: string; size: number; dataCenter: string };

export const createVolume = (key: string, name: string, size: number, dataCenter: string) =>
  runpod<Volume>(`${REST}/network-volumes`, key, { method: "POST", body: JSON.stringify({ name, size, dataCenter, type: "STANDARD" }) });

export const deleteVolume = (key: string, id: string) => runpod<void>(`${REST}/network-volumes/${id}`, key, { method: "DELETE" });

/** RunPod only lets a volume grow. */
export const resizeVolume = (key: string, id: string, size: number) =>
  runpod<Volume>(`${REST}/network-volumes/${id}`, key, { method: "PATCH", body: JSON.stringify({ size }) });

export type LogLine = { source: "system" | "container"; line: string; ts: string };

/**
 * Streams the pod's RunPod logs (system: image pull; container: vLLM download and load) until the stream
 * ends or signal aborts. since = ts of the last line seen, to resume; empty backfills the last 300 lines.
 */
export async function podLogs(key: string, id: string, since: string, onLine: (l: LogLine) => void, signal: AbortSignal) {
  const q = since ? `since=${encodeURIComponent(since)}` : "tail=300";
  const res = await http(`${REST}/pods/${id}/logs?${q}`, { headers: { Authorization: `Bearer ${key}` }, signal });
  if (res.status === 401 || res.status === 403) throw new Error("RunPod rejected this key");
  if (!res.ok || !res.body) throw new Error(`RunPod logs error ${res.status}`);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  signal.addEventListener("abort", () => void reader.cancel().catch(() => {})); // the Tauri fetch abort may not cut a body already streaming
  let rest = "";
  for (let r = await reader.read(); !r.done; r = await reader.read()) {
    const raw = rest + r.value;
    const cut = raw.lastIndexOf("\n") + 1; // only complete lines parse
    rest = raw.slice(cut);
    for (const l of sseData(raw.slice(0, cut)) as LogLine[]) {
      const line = logText(l.line);
      if (line) onLine({ ...l, line });
    }
  }
}

// ponytail: the whole data-center list once per app run (~40 rows); unknown ids show as the id
let dataCenters: Promise<DataCenter[]> | null = null;
export function getDataCenters(key: string): Promise<DataCenter[]> {
  dataCenters ??= runpod<{ dataCenters: DataCenter[] }>(`${REST}/catalog/datacenters`, key)
    .then((r) => r.dataCenters)
    .catch((e) => {
      dataCenters = null; // try again next time
      throw e;
    });
  return dataCenters;
}
export const getDatacenterName = async (key: string, id: string) => placeName(id, await getDataCenters(key));

// --- chat (vLLM on the pod, through RunPod's public proxy, guarded by vLLM's --api-key) ---------------

export const podUrl = (id: string) => `https://${id}-8000.proxy.runpod.net`;

/** vLLM answers /v1/models once the model is loaded; before that the proxy returns 404/502. */
export async function podReady(id: string, apiKey: string): Promise<boolean> {
  try {
    return (await http(`${podUrl(id)}/v1/models`, { headers: { Authorization: `Bearer ${apiKey}` } })).ok;
  } catch {
    return false;
  }
}

/** Load on the pod from vLLM's /metrics (any client, not just Hose); null while it can't be read. */
export async function podLoad(id: string, apiKey: string) {
  try {
    const res = await http(`${podUrl(id)}/metrics`, { headers: { Authorization: `Bearer ${apiKey}` } });
    return res.ok ? vllmLoad(await res.text()) : null;
  } catch {
    return null;
  }
}

// images: data URLs (sent photos, or the picture a picture model made); file: where that picture was saved
export type Message = { role: "user" | "assistant"; content: string; images?: string[]; thinking?: string; stats?: string; file?: string };
export type Reply = { content: string; thinking: string; stats: string };

/** Streams the reply; onReply gets the whole reply so far after every chunk. Resolves with the full reply and its stats. */
export async function chatStream(id: string, apiKey: string, model: string, messages: Message[], think: boolean, onReply: (r: Reply) => void) {
  const start = performance.now();
  const seeing = messages.some((m) => m.images?.length);
  const res = await http(`${podUrl(id)}/v1/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      // thinking and stats stay on this Mac; images go as OpenAI-style image_url parts
      messages: messages.map(({ role, content, images }) => ({
        role,
        content: images?.length ? [{ type: "text", text: content }, ...images.map((url) => ({ type: "image_url", image_url: { url } }))] : content,
      })),
      stream: true,
      stream_options: { include_usage: true },
      // thinking, or a page read out, runs to thousands of tokens: no cap then, vLLM allows what's left of the context
      ...(think || seeing ? {} : { max_tokens: 1024 }),
      temperature: 0.7,
      // models without a thinking mode ignore it; gpt-oss always reasons and sends it in a separate field
      chat_template_kwargs: { enable_thinking: think },
    }),
  });
  // vLLM's message says why, e.g. too many images or pages for the model's context
  if (!res.ok || !res.body) throw new Error(`The model answered with error ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let raw = "";
  let first = 0;
  for (let r = await reader.read(); !r.done; r = await reader.read()) {
    raw += r.value;
    // only complete lines parse; ponytail: a model with no thinking mode shows its answer as thinking until the end
    const { content, thinking } = sseReply(raw.slice(0, raw.lastIndexOf("\n") + 1), think);
    if (!first && (content || thinking)) first = performance.now();
    onReply({ content, thinking, stats: "" });
  }
  const { content, thinking, usage } = sseReply(raw);
  if (!content && !thinking) throw new Error("The model sent back an empty reply. Try sending again.");
  const end = performance.now();
  const reply = { content, thinking, stats: usage ? replyStats(usage, (first || end) - start, first ? end - first : 0) : "" };
  onReply(reply);
  return reply;
}

/**
 * One picture from a vLLM-Omni pod as a PNG data URL. size "1024x1024"; params: the pod's Picture settings (drawParams),
 * an unset one left out so vLLM-Omni uses its default. A request takes 10–60 s and isn't streamed.
 */
export async function drawImage(id: string, apiKey: string, model: string, prompt: string, size: string, params: DrawParams = {}) {
  const res = await http(`${podUrl(id)}/v1/images/generations`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt, size, n: 1, response_format: "b64_json", ...params }),
  });
  if (!res.ok) {
    // vLLM-Omni says why in {"error": {"message"}} (bad size) or {"detail"} (server busy)
    const text = await res.text();
    let why = text.slice(0, 200);
    try {
      const j = JSON.parse(text);
      why = j.error?.message ?? j.detail ?? why;
    } catch {}
    throw new Error(`The model answered with error ${res.status}: ${why}`);
  }
  const b64 = (await res.json()).data?.[0]?.b64_json;
  if (!b64) throw new Error("The model sent back no picture. Try again.");
  return `data:image/png;base64,${b64}`;
}

// --- Hugging Face ------------------------------------------------------------

const hfHeaders = (token: string): HeadersInit => (token ? { Authorization: `Bearer ${token}` } : {});

export async function hfWhoami(token: string): Promise<string> {
  const res = await http(`${HF}/api/whoami-v2`, { headers: hfHeaders(token) });
  if (!res.ok) throw new Error("Hugging Face rejected this token");
  return (await res.json()).name;
}

export async function hfModelInfo(id: string, token: string): Promise<HfInfo> {
  const q = ["pipeline_tag", "gated", "safetensors", "config"].map((f) => `expand[]=${f}`).join("&");
  const res = await http(`${HF}/api/models/${id}?${q}`, { headers: hfHeaders(token) });
  if (res.status === 404 || res.status === 401) throw new Error("No model with that name on Hugging Face");
  if (!res.ok) throw new Error(`Hugging Face error ${res.status}`);
  return { ...(await res.json()), id };
}

export type HfHit = { id: string; params: Record<string, number>; downloads: number; gated: boolean | string; thinks: boolean; vision?: boolean; draws?: boolean };

/**
 * Chat models matching q (picture models with draws), by one owner if author is set, in HF's order for sort
 * (downloads | trendingScore | createdAt, all highest first). Repos parseHfModel rejects (GGUF, base models without a
 * chat template, pictures vLLM-Omni can't run…) are dropped.
 */
export async function hfSearch(q: string, token: string, { author = "", sort = "downloads", draws = false } = {}): Promise<HfHit[]> {
  const expand = ["pipeline_tag", "safetensors", "downloads", "gated", "config"].map((f) => `expand[]=${f}`).join("&");
  const by = (author ? `&author=${encodeURIComponent(author)}` : "") + (draws ? "&pipeline_tag=text-to-image&library=diffusers" : "");
  const res = await http(`${HF}/api/models?search=${encodeURIComponent(q)}${by}&sort=${sort}&limit=40&${expand}`, { headers: hfHeaders(token) });
  if (!res.ok) throw new Error(`Hugging Face error ${res.status}`);
  const all: (HfInfo & { downloads: number })[] = await res.json();
  return all
    .flatMap((m) => {
      const r = parseHfModel(m, true); // gated hits stay listed; choose() asks for the token
      return r.ok && !!r.model.draws === draws ? [{ ...r.model, downloads: m.downloads, gated: m.gated ?? false, thinks: thinks(m) }] : [];
    })
    .slice(0, 12);
}

// Gated models: the token must belong to someone who accepted the licence on the model page.
// A diffusers (picture) repo has model_index.json at its root instead of config.json.
export async function hfCanDownload(id: string, token: string, draws = false): Promise<boolean> {
  const res = await http(`${HF}/${id}/resolve/main/${draws ? "model_index.json" : "config.json"}`, { method: "HEAD", headers: hfHeaders(token) });
  return res.ok;
}
