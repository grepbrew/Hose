// Pure logic: model sizing, GPU cards, Pod spec, cost math. No I/O here so it stays unit-testable.

export type Cloud = "SECURE" | "COMMUNITY";

/** One item of GET /v2/catalog/gpus. price.<cloud> is null when the GPU isn't offered on that cloud. */
export type Gpu = {
  id: string;
  name: string;
  memory: number;
  secure: boolean;
  community: boolean;
  price: { secure: number | null; community: number | null };
  availability?: string;
};

export type Model = { id: string; params: Record<string, number> };

export type Preset = Model & { label: string; blurb: string; tag: string; size: "S" | "M" | "L"; gated?: boolean };

// Locked on the signed-off mockup (2026-10-22). Params from the HF API; vLLM v0.32.0 registers every architecture here.
// Qwen3.5/3.8 and Gemma 4 are image-text-to-text models; Hose only sends them text.
export const PRESETS: Preset[] = [
  { size: "S", label: "Qwen3.5-4B", blurb: "Quick everyday answers", tag: "Qwen · new", id: "Qwen/Qwen3.5-4B", params: { BF16: 4659861248, F32: 3840 } },
  { size: "S", label: "Qwen3-4B-Instruct", blurb: "Fast, text only", tag: "Qwen", id: "Qwen/Qwen3-4B-Instruct-2507", params: { BF16: 4022468096 } },
  { size: "S", label: "Phi-4-mini", blurb: "Small, good at reasoning", tag: "Microsoft", id: "microsoft/Phi-4-mini-instruct", params: { BF16: 3836021760 } },
  { size: "M", label: "Qwen3.5-9B", blurb: "Good all-rounder for writing and reasoning", tag: "Qwen · new", id: "Qwen/Qwen3.5-9B", params: { BF16: 9653100528, F32: 3840 } },
  { size: "M", label: "Llama-3.1-8B", blurb: "Meta's popular 8B", tag: "Meta", id: "meta-llama/Llama-3.1-8B-Instruct", params: { BF16: 8030261248 }, gated: true },
  { size: "M", label: "Granite-4.2-8B", blurb: "Clear, businesslike writing", tag: "IBM · new", id: "ibm-granite/granite-4.2-8b", params: { BF16: 8791592960 } },
  { size: "L", label: "Qwen3.8-27B", blurb: "Strongest that fits one GPU", tag: "Qwen · new", id: "Qwen/Qwen3.8-27B", params: { BF16: 27781427952 } },
  { size: "L", label: "Gemma-4-26B-A4B", blurb: "Fast for its size", tag: "Google · new", id: "google/gemma-4-26B-A4B-it", params: { BF16: 25805936206 } },
  { size: "L", label: "gpt-oss-20b", blurb: "OpenAI's open model", tag: "OpenAI", id: "openai/gpt-oss-20b", params: { BF16: 1804459584, U8: 19110297600 } },
];

/** Short display name: the curated label, else the repo name. */
export const label = (id: string) => PRESETS.find((p) => p.id === id)?.label ?? id.split("/").pop()!;

// ponytail: F32 counted as 2 bytes because vLLM loads weights in bf16 by default.
// U8/I8 counted as 1 byte, so packed 4-bit weights (gpt-oss MXFP4) are over-estimated: safe side.
const BYTES: Record<string, number> = { F32: 2, BF16: 2, F16: 2, F8_E4M3: 1, F8_E5M2: 1, I8: 1, U8: 1 };

export const weightsGb = (params: Record<string, number>) =>
  Object.entries(params).reduce((sum, [dtype, n]) => sum + n * (BYTES[dtype] ?? 2), 0) / 1e9;

// weights + 20% runtime overhead + 2 GB KV cache for an 8k context
export const vramNeededGb = (params: Record<string, number>) => weightsGb(params) * 1.2 + 2;

export type GpuCard = { id: string; name: string; memory: number; price: number; stock: string; fits: boolean; reason: string };

/** Cards for the GPU picker: every GPU offered on this cloud, cheapest first, marked whether it can run the model. */
export function gpuCards(catalog: Gpu[], cloud: Cloud, needGb: number): GpuCard[] {
  const key = cloud === "SECURE" ? "secure" : "community";
  return catalog
    .filter((g) => g[key] && g.price[key])
    .map((g) => {
      const stock = g.availability ?? "NONE";
      const reason = g.memory < needGb ? "Too small" : stock === "NONE" ? "Sold out" : "";
      return { id: g.id, name: g.name, memory: g.memory, price: g.price[key]!, stock, fits: !reason, reason };
    })
    .sort((a, b) => a.price - b.price);
}

export type HfInfo = {
  id: string;
  pipeline_tag?: string;
  gated?: boolean | string;
  safetensors?: { parameters: Record<string, number> };
};

/** HF pipeline tags Hose can chat with. image-text-to-text models (Qwen3.5, Gemma 4) take plain text too. */
export const CHAT_TAGS = ["text-generation", "image-text-to-text"];

export function parseHfModel(info: HfInfo, hasToken: boolean): { ok: true; model: Model } | { ok: false; reason: string } {
  if (!CHAT_TAGS.includes(info.pipeline_tag ?? "")) return { ok: false, reason: "not a chat model" };
  if (info.gated && !hasToken) return { ok: false, reason: "needs Hugging Face token" };
  if (!info.safetensors) return { ok: false, reason: "unknown model size (no safetensors weights)" };
  return { ok: true, model: { id: info.id, params: info.safetensors.parameters } };
}

// CUDA 13.0 build. The -cu129 tag crash-loops: its torchcodec wants libnvrtc.so.13 (spike 2026-10-22).
export const VLLM_IMAGE = "vllm/vllm-openai:v0.32.0";

/** Container disk for a model: weights plus room for the HF download cache and vLLM. */
export const diskGb = (params: Record<string, number>) => Math.ceil(weightsGb(params) * 1.5) + 20;

const slug = (id: string) => id.split("/").pop()!.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);

/**
 * POST /v2/pods body. The watchdog script rides along in env and starts next to vLLM; it deletes the Pod
 * after idleMin quiet minutes, so a forgotten model stops billing even with Hose closed.
 */
export function podInput(model: Model, gpuId: string, cloud: Cloud, hfToken: string, apiKey: string, idleMin: number, watchdog: string) {
  return {
    name: `hose-${slug(model.id)}`,
    image: VLLM_IMAGE,
    gpu: { id: gpuId, count: 1, minCudaVersion: "13.0" },
    cloud,
    disk: diskGb(model.params),
    ports: ["8000/http"],
    env: {
      MODEL: model.id,
      HOSE_KEY: apiKey,
      HOSE_IDLE_MIN: String(idleMin),
      HOSE_WATCHDOG: watchdog,
      ...(hfToken ? { HF_TOKEN: hfToken } : {}),
    },
    entrypoint: [
      "bash",
      "-c",
      // no exec: if vLLM dies the container stays up and this watchdog deletes the pod. A container restart would
      // start a fresh watchdog with a fresh boot timer, so a crash loop could bill forever.
      'python3 -c "$HOSE_WATCHDOG" & vllm serve "$MODEL" --port 8000 --api-key "$HOSE_KEY" --max-model-len 8192; sleep infinity',
    ],
  };
}

/** JSON payload of every `data:` line in raw SSE (complete lines only); `[DONE]` skipped. */
export const sseData = (raw: string): any[] =>
  raw
    .split("\n")
    .filter((l) => l.startsWith("data: ") && l !== "data: [DONE]")
    .map((l) => JSON.parse(l.slice(6)));

/** Text carried by OpenAI-style SSE from vLLM /v1/chat/completions with stream: true. */
export const sseText = (raw: string) =>
  sseData(raw)
    .map((d) => d.choices?.[0]?.delta?.content ?? "")
    .join("");

// ponytail: covers tqdm (\r-separated updates) and colour codes; other terminal escapes pass through as-is
/** A pod log line as a person reads it: the last progress update, no colour codes. */
export const logText = (line: string) =>
  (line.split("\r").filter((s) => s.trim()).pop() ?? "").replace(/\x1b\[[0-9;]*m/g, "").trim();

/** Pods bill per second while RUNNING; `cost` is RunPod's $/hr for that pod. */
export const burnRatePerHr = (pods: { status: string; cost: number }[]) =>
  pods.filter((p) => p.status === "RUNNING").reduce((sum, p) => sum + p.cost, 0);

// --- configs: what the sidebar lists, kept on this Mac -------------------------------------------

/** The GET /v2/pods fields Hose reads (Pod schema, api.runpod.io/v2/openapi.json). */
export type Pod = {
  id: string;
  name: string;
  status: string;
  cost: number;
  createdAt?: string;
  startedAt?: string | null;
  dataCenterId?: string | null;
  image?: string;
  disk?: number;
  cloud?: Cloud;
  gpu?: { id: string; count: number; vcpuCount: number; memory: number };
  runtime?: { uptime: number } | null; // seconds since the container started; null unless RUNNING
};

/** Machine details saved while the pod is alive: a deleted pod 404s, so this is all that's left of it. */
export type Last = { dataCenter: string; vcpu: number; memoryGb: number; diskGb: number; image: string; startedAt: string; runSpend: number };

/** A model on a GPU the user set up. Turn off deletes its Pod; this record is what Turn on rebuilds it from. */
export type Config = Model & {
  key: string;
  name: string;
  gpuId: string;
  gpuName: string;
  cloud: Cloud;
  idleMin: number;
  price?: number; // $/hr when it was picked, for "Costs when on"
  vram?: number; // GPU memory in GB, from the catalog when it was picked
  podId?: string;
  pastPodIds: string[];
  spentPast: number; // ≈ $ of finished runs
  last?: Last;
};

/** Records saved before 2026-10-22 had no key or name: one config per model id. */
export const migrateConfigs = (raw: any[]): Config[] =>
  raw.map((c) =>
    c.key ? c : { ...c, key: crypto.randomUUID(), name: `${label(c.id)} · ${c.gpuName}`, pastPodIds: [], spentPast: 0 },
  );

export const upsertConfig = (list: Config[], c: Config) =>
  list.some((x) => x.key === c.key) ? list.map((x) => (x.key === c.key ? c : x)) : [...list, c];

// ponytail: spend is estimated (time × $/hr), not read from RunPod billing; shown with "≈"
export function spendTotals(c: Config) {
  const run = c.podId ? (c.last?.runSpend ?? 0) : 0;
  return { run, allTime: c.spentPast + run };
}

/** Pods bill from creation (image download included), so the run estimate counts from createdAt. */
export function snapshotOf(pod: Pod, dataCenter: string, now: number): Last {
  const hours = pod.createdAt ? Math.max(0, now - Date.parse(pod.createdAt)) / 3.6e6 : 0;
  return {
    dataCenter,
    vcpu: pod.gpu?.vcpuCount ?? 0,
    memoryGb: pod.gpu?.memory ?? 0,
    diskGb: pod.disk ?? 0,
    image: pod.image ?? "",
    startedAt: pod.startedAt ?? pod.createdAt ?? "",
    runSpend: hours * pod.cost,
  };
}

/** The pod is gone (turned off, or its watchdog deleted it): bank the run's spend, keep the machine details. */
export function endRun(c: Config) {
  if (c.podId) c.pastPodIds.push(c.podId);
  c.spentPast += c.last?.runSpend ?? 0;
  if (c.last) c.last.runSpend = 0;
  c.podId = undefined;
}

export function sidebarGroups<P extends { id: string }>(configs: Config[], pods: P[]) {
  return {
    running: configs.filter((c) => c.podId),
    saved: configs.filter((c) => !c.podId),
    // hose-* pods with no config here (made on another Mac): listed so they can be turned off
    strays: pods.filter((p) => !configs.some((c) => c.podId === p.id)),
  };
}

export type Sel = { kind: "new" } | { kind: "keys" } | { kind: "config"; key: string } | { kind: "stray"; podId: string };

/** Launch: the last viewed item if it still exists, else the first running pod, else New pod. */
export function initialSelection(stored: Sel | null, configs: Config[], pods: { id: string }[]): Sel {
  const exists =
    stored &&
    (stored.kind === "config" ? configs.some((c) => c.key === stored.key) : stored.kind === "stray" ? pods.some((p) => p.id === stored.podId) : true);
  if (stored && exists) return stored;
  const on = configs.find((c) => c.podId);
  return on ? { kind: "config", key: on.key } : { kind: "new" };
}

// --- display ---------------------------------------------------------------------------------------

export const usd = (n: number | null | undefined, digits = 2) => (n == null ? "…" : `$${n.toFixed(digits)}`);

/** 42 min, 2 h 14 min */
export function duration(ms: number) {
  const min = Math.max(0, Math.round(ms / 60000));
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
}

/** today, yesterday, 3 days ago */
export function ago(iso: string, now: number) {
  const days = Math.floor((new Date(now).setHours(0, 0, 0, 0) - new Date(iso).setHours(0, 0, 0, 0)) / 864e5);
  return days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
}

/** 7.6B */
export const billions = (params: Record<string, number>) => `${(Object.values(params).reduce((a, b) => a + b, 0) / 1e9).toFixed(1)}B`;
