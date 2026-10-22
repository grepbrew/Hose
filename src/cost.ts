// Pure logic: model sizing, GPU picking, cost math. No I/O here so it stays unit-testable.

export type Gpu = {
  id: string;
  pool: string;
  memory: number;
  price: { serverless: number };
  availability?: string;
};

export type Model = { id: string; params: Record<string, number> };

export type Preset = Model & { label: string; blurb: string };

export const PRESETS: Preset[] = [
  { label: "Fast", blurb: "Quick answers, everyday questions", id: "Qwen/Qwen3-4B-Instruct-2507", params: { BF16: 4022468096 } },
  { label: "Balanced", blurb: "Good all-rounder for writing and reasoning", id: "Qwen/Qwen3-8B", params: { BF16: 8190735360 } },
  { label: "Smarter", blurb: "Better at harder tasks, costs more", id: "Qwen/Qwen3-14B", params: { BF16: 14768307200 } },
];

// ponytail: F32 counted as 2 bytes because vLLM loads weights in bf16 by default.
// U8/I8 counted as 1 byte, so packed 4-bit weights (gpt-oss MXFP4) are over-estimated: safe side.
const BYTES: Record<string, number> = { F32: 2, BF16: 2, F16: 2, F8_E4M3: 1, F8_E5M2: 1, I8: 1, U8: 1 };

export const weightsGb = (params: Record<string, number>) =>
  Object.entries(params).reduce((sum, [dtype, n]) => sum + n * (BYTES[dtype] ?? 2), 0) / 1e9;

// weights + 20% runtime overhead + 2 GB KV cache for an 8k context
export const vramNeededGb = (params: Record<string, number>) => weightsGb(params) * 1.2 + 2;

/** Cheapest two GPU pools that fit, so RunPod has a fallback when the first is sold out. */
export function pickPools(catalog: Gpu[], needGb: number) {
  const pools = new Map<string, { memory: number; price: number }>();
  for (const g of catalog) {
    if (g.memory < needGb || g.availability === "NONE" || !g.price.serverless) continue;
    const p = pools.get(g.pool);
    // a pool mixes GPU types; quote the dearest so the shown price is a ceiling
    pools.set(g.pool, { memory: g.memory, price: Math.max(p?.price ?? 0, g.price.serverless) });
  }
  const picked = [...pools].sort((a, b) => a[1].price - b[1].price).slice(0, 2);
  if (!picked.length) throw new Error(`Model too big: needs ~${Math.ceil(needGb)} GB, no available GPU has that much`);
  // RunPod may land on either pool, so quote the range
  return { pools: picked.map(([pool]) => pool), price: { from: picked[0][1].price, to: picked.at(-1)![1].price } };
}

export type HfInfo = {
  id: string;
  pipeline_tag?: string;
  gated?: boolean | string;
  safetensors?: { parameters: Record<string, number> };
};

export function parseHfModel(info: HfInfo, hasToken: boolean): { ok: true; model: Model } | { ok: false; reason: string } {
  if (info.pipeline_tag !== "text-generation") return { ok: false, reason: "not a chat model" };
  if (info.gated && !hasToken) return { ok: false, reason: "needs Hugging Face token" };
  if (!info.safetensors) return { ok: false, reason: "unknown model size (no safetensors weights)" };
  return { ok: true, model: { id: info.id, params: info.safetensors.parameters } };
}

export type WorkerLike = { gpuTypeId: string; gpuCount: number; status: string };

// Flex workers bill per second from start until fully stopped, including cold start and idle timeout.
const BILLED = new Set(["running", "idle", "initializing"]);
const billed = (w: WorkerLike) => BILLED.has(w.status.toLowerCase());

export const burnRatePerHr = (workers: WorkerLike[], priceByGpu: Record<string, number>) =>
  workers.filter(billed).reduce((sum, w) => sum + (priceByGpu[w.gpuTypeId] ?? 0) * w.gpuCount, 0);

export function gpuState(workers: WorkerLike[]): "Asleep" | "Waking up" | "Ready" | "Answering" {
  const st = new Set(workers.filter(billed).map((w) => w.status.toLowerCase()));
  if (st.has("running")) return "Answering";
  if (st.has("idle")) return "Ready";
  if (st.has("initializing")) return "Waking up";
  return "Asleep";
}

export const VLLM_IMAGE = "runpod/worker-v1-vllm:v2.30.0";

const slug = (id: string) => id.split("/").pop()!.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);

/** GraphQL saveEndpoint input. Spend guardrail: no always-on workers (scale to zero after 60 s idle), at most one GPU. */
export function endpointInput(model: Model, pools: string[], hfToken: string, stamp = Date.now()) {
  const env = [
    { key: "MODEL_NAME", value: model.id },
    { key: "MAX_MODEL_LEN", value: "8192" },
    ...(hfToken ? [{ key: "HF_TOKEN", value: hfToken }] : []),
  ];
  const name = `hose-${slug(model.id)}`;
  return {
    name,
    gpuIds: pools.join(","),
    gpuCount: 1,
    workersMin: 0,
    workersMax: 1,
    idleTimeout: 60,
    scalerType: "QUEUE_DELAY",
    scalerValue: 4,
    flashBootType: "FLASHBOOT",
    minCudaVersion: "13.0",
    modelReferences: [`https://huggingface.co/${model.id}:main`],
    template: {
      name: `${name}-${stamp}`,
      imageName: VLLM_IMAGE,
      containerDiskInGb: Math.ceil(weightsGb(model.params) * 1.5) + 20,
      dockerArgs: "",
      env,
    },
  };
}

type Chunk = { output: unknown };
/** Text carried by a batch of /stream chunks from the vLLM worker. */
export const streamText = (stream: Chunk[]) =>
  stream.map((c) => (c.output as { choices?: { tokens?: string[] }[] }).choices?.[0]?.tokens?.join("") ?? "").join("");
