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

export function parseHfModel(info: HfInfo, hasToken: boolean): { ok: true; model: Model } | { ok: false; reason: string } {
  if (info.pipeline_tag !== "text-generation") return { ok: false, reason: "not a chat model" };
  if (info.gated && !hasToken) return { ok: false, reason: "needs Hugging Face token" };
  if (!info.safetensors) return { ok: false, reason: "unknown model size (no safetensors weights)" };
  return { ok: true, model: { id: info.id, params: info.safetensors.parameters } };
}

// CUDA 13.0 build. The -cu129 tag crash-loops: its torchcodec wants libnvrtc.so.13 (spike 2026-10-22).
export const VLLM_IMAGE = "vllm/vllm-openai:v0.32.0";

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
    disk: Math.ceil(weightsGb(model.params) * 1.5) + 20,
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

/** Text carried by OpenAI-style SSE from vLLM /v1/chat/completions with stream: true. */
export const sseText = (raw: string) =>
  raw
    .split("\n")
    .filter((l) => l.startsWith("data: ") && l !== "data: [DONE]")
    .map((l) => JSON.parse(l.slice(6)).choices?.[0]?.delta?.content ?? "")
    .join("");

/** Pods bill per second while RUNNING; `cost` is RunPod's $/hr for that pod. */
export const burnRatePerHr = (pods: { status: string; cost: number }[]) =>
  pods.filter((p) => p.status === "RUNNING").reduce((sum, p) => sum + p.cost, 0);
