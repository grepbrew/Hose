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
  dataCenters?: { id: string; availability: string }[]; // Secure cloud only: Community reports no locations
};

/** One item of GET /v2/catalog/datacenters. networkVolumeTypes: [] = no network volumes there. */
export type DataCenter = { id: string; name: string; region: string; networkVolumeTypes?: string[] };

/** Data center ids a location covers: "" = anywhere, a region (EUROPE) = its data centers, else one data center. */
export const dcIds = (location: string, dcs: DataCenter[]) =>
  !location ? [] : dcs.some((d) => d.region === location) ? dcs.filter((d) => d.region === location).map((d) => d.id) : [location];

const countries = new Intl.DisplayNames(["en"], { type: "region" });
// RunPod's data center names are just the ids (2026-10-22), so name the country: US-TX-3, CA-MTL-1, EU-RO-1, EUR-IS-2, AP-JP-1
function countryOf(id: string) {
  const [a, b] = id.split("-");
  try {
    return countries.of(a === "US" || a === "CA" ? a : b);
  } catch {
    return undefined; // not a country code
  }
}

/** EUROPE → Europe, NORTH_AMERICA → North America, EU-RO-1 → Romania (EU-RO-1), or RunPod's name if it has a real one. */
export function placeName(location: string, dcs: DataCenter[]) {
  if (dcs.some((d) => d.region === location))
    return location
      .split("_")
      .map((w) => w[0] + w.slice(1).toLowerCase())
      .join(" ");
  const name = dcs.find((d) => d.id === location)?.name;
  if (name && name !== location) return name;
  const country = countryOf(location);
  return country ? `${country} (${location})` : location;
}

// vision: reads images (HF image-text-to-text). draws: makes pictures from text (HF text-to-image, served by vLLM-Omni)
export type Model = { id: string; params: Record<string, number>; vision?: boolean; draws?: boolean };

export type Preset = Model & { label: string; blurb: string; tag: string; thinks: boolean; gated?: boolean; active?: number; steps?: number };

// Locked on the signed-off mockup (2026-10-22; Coder added for the quick start 2026-10-23). Params from the HF API;
// vLLM v0.32.0 registers every architecture here. thinks = thinks() on each repo's chat template (2026-10-23).
// active = parameters each token reads, for a mixture-of-experts repo whose name doesn't say it (activeGb).
// vision = HF tags it image-text-to-text (2026-10-23): it reads photos, screenshots and PDF pages too.
export const PRESETS: Preset[] = [
  { label: "Qwen3.5-4B", blurb: "Quick everyday answers", tag: "Qwen · new", thinks: true, vision: true, id: "Qwen/Qwen3.5-4B", params: { BF16: 4659861248, F32: 3840 } },
  { label: "Qwen3-4B-Instruct", blurb: "Fast, text only", tag: "Qwen", thinks: false, id: "Qwen/Qwen3-4B-Instruct-2507", params: { BF16: 4022468096 } },
  { label: "Phi-4-mini", blurb: "Small, good at reasoning", tag: "Microsoft", thinks: false, id: "microsoft/Phi-4-mini-instruct", params: { BF16: 3836021760 } },
  { label: "Qwen3.5-9B", blurb: "Good all-rounder for writing and reasoning", tag: "Qwen · new", thinks: true, vision: true, id: "Qwen/Qwen3.5-9B", params: { BF16: 9653100528, F32: 3840 } },
  { label: "Llama-3.1-8B", blurb: "Meta's popular 8B", tag: "Meta", thinks: false, id: "meta-llama/Llama-3.1-8B-Instruct", params: { BF16: 8030261248 }, gated: true },
  { label: "Granite-4.2-8B", blurb: "Clear, businesslike writing", tag: "IBM · new", thinks: true, id: "ibm-granite/granite-4.2-8b", params: { BF16: 8791592960 } },
  { label: "Qwen3.8-27B", blurb: "Strongest that fits one GPU", tag: "Qwen · new", thinks: true, vision: true, id: "Qwen/Qwen3.8-27B", params: { BF16: 27781427952 } },
  { label: "Gemma-4-26B-A4B", blurb: "Fast for its size", tag: "Google · new", thinks: true, vision: true, id: "google/gemma-4-26B-A4B-it", params: { BF16: 25805936206 } },
  { label: "gpt-oss-20b", blurb: "OpenAI's open model", tag: "OpenAI", thinks: true, active: 3.6e9, id: "openai/gpt-oss-20b", params: { BF16: 1804459584, U8: 19110297600 } },
  { label: "Qwen3-Coder-30B", blurb: "Writes and fixes code", tag: "Qwen", thinks: false, id: "Qwen/Qwen3-Coder-30B-A3B-Instruct-FP8", params: { BF16: 636948480, F8_E4M3: 29896998912 } },
];

// Picture models (2026-10-23), all served by vLLM-Omni v0.30.0. params = the transformer's (HF safetensors), steps = what
// the model card recommends: vLLM-Omni's default (~50) took 55 s a picture on the spike's A40, Z-Image-Turbo at 9 took 12.7 s.
export const PICTURES: Preset[] = [
  { label: "Z-Image-Turbo", blurb: "Fast, photo-like pictures", tag: "Alibaba · new", thinks: false, draws: true, steps: 9, id: "Tongyi-MAI/Z-Image-Turbo", params: { F32: 6154908736 } },
  { label: "FLUX.1-schnell", blurb: "Quick, any style", tag: "Black Forest Labs", thinks: false, draws: true, steps: 4, id: "black-forest-labs/FLUX.1-schnell", params: { BF16: 11891178560 }, gated: true },
  { label: "Qwen-Image", blurb: "Best with words in the picture", tag: "Qwen", thinks: false, draws: true, id: "Qwen/Qwen-Image", params: { BF16: 20430401088 } },
];

/** A curated chat or picture model. */
export const presetOf = (id: string) => [...PRESETS, ...PICTURES].find((p) => p.id === id);

/** New pod's quick start: one card per job, each a preset started in one click on the GPU Hose recommends. */
export const QUICK: { purpose: string; blurb: string; icon: "chat-circle-dots" | "scan" | "pen-nib" | "brain" | "code" | "lightning" | "image"; id: string; think?: boolean }[] = [
  { purpose: "Everyday questions", blurb: "Ask anything: plan a trip, explain a letter, compare two options.", icon: "chat-circle-dots", id: "Qwen/Qwen3.5-9B" },
  { purpose: "Read photos & documents", blurb: "Drop in a photo, screenshot or PDF. It reads out the text, tables too.", icon: "scan", id: "Qwen/Qwen3.5-9B" },
  { purpose: "Writing & email", blurb: "Drafts, rewrites and replies in a clear, friendly tone.", icon: "pen-nib", id: "ibm-granite/granite-4.2-8b" },
  { purpose: "Hard problems", blurb: "Thinks step by step before it answers. Slower, more careful.", icon: "brain", id: "Qwen/Qwen3.8-27B", think: true },
  { purpose: "Coding", blurb: "Writes, explains and fixes code in most languages.", icon: "code", id: "Qwen/Qwen3-Coder-30B-A3B-Instruct-FP8" },
  { purpose: "Fast & cheap", blurb: "Quick, short answers at the lowest price.", icon: "lightning", id: "Qwen/Qwen3.5-4B" },
  { purpose: "Make pictures", blurb: "Describe a picture and get it in seconds. Saved to your Pictures folder.", icon: "image", id: "Tongyi-MAI/Z-Image-Turbo" },
];

/** Short display name: the curated label, else the repo name. */
export const label = (id: string) => presetOf(id)?.label ?? id.split("/").pop()!;

/** The model reads images. Configs saved before the flag existed fall back to the preset's. */
export const seesImages = (m: Model) => m.vision ?? !!PRESETS.find((p) => p.id === m.id)?.vision;

/** Denoising steps for a picture model: the preset's, else undefined (vLLM-Omni's default). */
export const stepsOf = (id: string) => presetOf(id)?.steps;

// ponytail: F32 counted as 2 bytes because vLLM loads weights in bf16 by default.
// U8/I8 counted as 1 byte, so packed 4-bit weights (gpt-oss MXFP4) are over-estimated: safe side.
const BYTES: Record<string, number> = { F32: 2, BF16: 2, F16: 2, F8_E4M3: 1, F8_E5M2: 1, I8: 1, U8: 1 };

export const weightsGb = (params: Record<string, number>) =>
  Object.entries(params).reduce((sum, [dtype, n]) => sum + n * (BYTES[dtype] ?? 2), 0) / 1e9;

/**
 * GPU memory for a picture model: HF counts only the transformer, so ×1.6 guesses the text encoder and VAE beside it,
 * +6 GB for the activations. Z-Image-Turbo: 25.7 GB (spike peak 24.2), FLUX.1-schnell 44, Qwen-Image 71.
 * ponytail: a guess from the transformer alone; sum the repo's file sizes (HF tree API) if a model lands on a too-small GPU.
 */
const drawGb = (params: Record<string, number>) => weightsGb(params) * 1.6 + 6;

// weights + 20% runtime overhead + 2 GB KV cache for an 8k context
export const vramNeededGb = (params: Record<string, number>, draws = false) => (draws ? drawGb(params) : weightsGb(params) * 1.2 + 2);

/** GPU memory to run the model smoothly: weights + 20% runtime overhead + 8 GB of KV cache, room for long chats.
 * A picture model has no chat to grow: what it needs is all it needs. */
export const smoothGb = (params: Record<string, number>, draws = false) => (draws ? drawGb(params) : weightsGb(params) * 1.2 + 8);

// Memory bandwidth in GB/s by RunPod's GPU name (vendor spec sheets; names as the live catalog sends them, 2026-10-23).
// A reply streams one token per pass over the weights, so bandwidth sets reply speed. A MIG slice gets its share.
// ponytail: static table; a GPU missing here gets no speed estimate (tier "works") until it's added.
export const GPU_GBPS: Record<string, number> = {
  "RTX A2000": 288, "RTX A4000": 448, "RTX A4500": 640, "RTX A5000": 768, "RTX A6000": 768,
  "RTX 2000 Ada": 224, "RTX 4000 Ada": 360, "RTX 4000 Ada SFF": 280, "RTX 5000 Ada": 576, "RTX 6000 Ada": 960,
  "RTX 3070": 448, "RTX 3080": 760, "RTX 3080 Ti": 912, "RTX 3090": 936, "RTX 3090 Ti": 1008,
  "RTX 4070 Ti": 504, "RTX 4080": 717, "RTX 4080 SUPER": 736, "RTX 4090": 1008, "RTX 5080": 960, "RTX 5090": 1792,
  "RTX PRO 4000": 672, "RTX PRO 4500": 896, "RTX PRO 5000": 1344, "RTX PRO 6000": 1792, "RTX PRO 6000 MaxQ": 1792, "RTX PRO 6000 WK": 1792,
  "PRO 6000 MIG 24GB": 448, "PRO 6000 MIG 48GB": 896,
  L4: 300, L40: 864, L40S: 864, A40: 696,
  "Tesla V100": 900, "V100 SXM2": 900, "A100 PCIe": 1935, "A100 SXM": 2039, "A100 SXM 40GB": 1555,
  "H100 PCIe": 2000, "H100 SXM": 3350, "H100 NVL": 3900, "H200 SXM": 4800, "H200 NVL": 4800,
  B200: 8000, B300: 8000, MI300X: 5300,
};

// ponytail: calibration knobs, set on paper (vLLM reaches ~70% of peak bandwidth for one chat), not measured; tune
// them once real pods report tok/s. 20 tok/s reads comfortably, 40 feels instant.
const EFFICIENCY = 0.7;
const SMOOTH_TPS = 20;
const FAST_TPS = 40;

const paramCount = (params: Record<string, number>) => Object.values(params).reduce((a, b) => a + b, 0);

/**
 * GB each generated token reads. A mixture-of-experts model reads only its active experts: the preset's active count,
 * else the "-A3B" in the repo name (Qwen3-Coder-30B-A3B, gemma-4-26B-A4B), else all weights.
 * ponytail: name heuristic; an MoE repo whose name doesn't say it counts as dense, so it looks slower than it is (safe side).
 */
export function activeGb(m: Model) {
  const all = weightsGb(m.params);
  const active = PRESETS.find((p) => p.id === m.id)?.active ?? Number(/-A(\d+(?:\.\d+)?)B/i.exec(m.id)?.[1] ?? 0) * 1e9;
  return active ? Math.min(all, (all * active) / paramCount(m.params)) : all;
}

/** Estimated reply speed in tokens a second, one chat at a time; null for a GPU missing from GPU_GBPS. */
export const tokPerSec = (gpuName: string, m: Model) => (GPU_GBPS[gpuName] ? (GPU_GBPS[gpuName] * EFFICIENCY) / activeGb(m) : null);

export type GpuCard = {
  id: string;
  name: string;
  memory: number;
  price: number;
  stock: string;
  fits: boolean; // tier smooth or works
  reason: string; // "Too small" or "Sold out" when it doesn't fit
  tier: "smooth" | "works" | "too-small" | "sold-out";
  tps: number | null;
  note: string; // what the card says about running this model
};

const STOCK_RANK = ["NONE", "LOW", "MEDIUM", "HIGH"];

/**
 * Cards for the GPU picker: every GPU offered on this cloud, cheapest first, rated for the model. smooth = room for
 * long chats (smoothGb) and replies of 20 tok/s or more; works = it fits (vramNeededGb), but chats must stay short,
 * replies are slower or the speed is unknown. With data center ids, only GPUs offered there, with the best stock among them.
 */
export function gpuCards(catalog: Gpu[], cloud: Cloud, model: Model, ids: string[] = []): GpuCard[] {
  const key = cloud === "SECURE" ? "secure" : "community";
  const need = vramNeededGb(model.params, model.draws);
  const room = smoothGb(model.params, model.draws);
  return catalog
    .filter((g) => g[key] && g.price[key] && (!ids.length || g.dataCenters?.some((d) => ids.includes(d.id))))
    .map((g): GpuCard => {
      const here = g.dataCenters?.filter((d) => ids.includes(d.id)).map((d) => d.availability) ?? [];
      const stock = ids.length ? here.reduce((a, b) => (STOCK_RANK.indexOf(b) > STOCK_RANK.indexOf(a) ? b : a)) : (g.availability ?? "NONE");
      const reason = g.memory < need ? "Too small" : stock === "NONE" ? "Sold out" : "";
      // pictures stream no tokens: a GPU that fits runs the model at its speed, so it's the pick
      const tps = model.draws ? null : tokPerSec(g.name, model);
      const smooth = model.draws ? g.memory >= room : g.memory >= room && !!tps && tps >= SMOOTH_TPS;
      const tier = reason === "Too small" ? "too-small" : reason ? "sold-out" : smooth ? "smooth" : "works";
      const note = model.draws
        ? reason || "Fits"
        : reason || (smooth ? (tps! >= FAST_TPS ? "Fast replies" : "Smooth") : g.memory < room ? "Works · short chats only" : tps ? "Works · slower replies" : "Works");
      return { id: g.id, name: g.name, memory: g.memory, price: g.price[key]!, stock, fits: !reason, reason, tier, tps, note };
    })
    .sort((a, b) => a.price - b.price);
}

/** The GPU Hose picks: the cheapest smooth one with GPUs to spare (HIGH/MEDIUM stock), else the cheapest smooth, else the cheapest that works. */
export function recommend(cards: GpuCard[]): GpuCard | null {
  const cheapest = (ok: (c: GpuCard) => boolean) => cards.filter(ok).sort((a, b) => a.price - b.price)[0];
  return (
    cheapest((c) => c.tier === "smooth" && (c.stock === "HIGH" || c.stock === "MEDIUM")) ??
    cheapest((c) => c.tier === "smooth") ??
    cheapest((c) => c.tier === "works") ??
    null
  );
}

/** Location choices: data centers that offer at least one GPU in the catalog, grouped by region. */
export function regionsOf(catalog: Gpu[], dcs: DataCenter[]) {
  const offered = new Set(catalog.flatMap((g) => g.dataCenters?.map((d) => d.id) ?? []));
  const groups: Record<string, DataCenter[]> = {};
  for (const d of dcs) if (offered.has(d.id)) (groups[d.region] ??= []).push(d);
  return Object.entries(groups);
}

export type HfInfo = {
  id: string;
  pipeline_tag?: string;
  gated?: boolean | string;
  safetensors?: { parameters: Record<string, number> };
  config?: { tokenizer_config?: { chat_template?: unknown }; chat_template_jinja?: string; diffusers?: { _class_name?: string } };
};

/** HF pipeline tags Hose can chat with. image-text-to-text models (Qwen3.5, Gemma 4) take text, images or both. */
export const CHAT_TAGS = ["text-generation", "image-text-to-text"];

/**
 * Diffusers pipelines vLLM-Omni v0.30.0 serves for text-to-image (vllm_omni/diffusion/registry.py), matched on the
 * repo's config.diffusers._class_name. ponytail: pinned to that registry; refresh it when OMNI_IMAGE moves.
 */
export const T2I_PIPES = [
  "FluxPipeline", "Flux2Pipeline", "Flux2KleinPipeline", "QwenImagePipeline", "ZImagePipeline", "StableDiffusion3Pipeline",
  "StableDiffusionXLPipeline", "HiDreamImagePipeline", "LongCatImagePipeline", "OvisImagePipeline", "GlmImagePipeline",
  "ErnieImagePipeline", "Krea2Pipeline", "HunyuanImage3Pipeline",
];

/** The chat template has a thinking switch: enable_thinking (Qwen3, Granite, Gemma 4), <think> (DeepSeek-R1), reasoning_effort (gpt-oss). */
export const thinks = (info: HfInfo) =>
  /enable_thinking|<think>|reasoning_effort/.test(JSON.stringify([info.config?.tokenizer_config?.chat_template, info.config?.chat_template_jinja]));

/** Size filter: Small under 7B parameters, Medium 7–20B, Large over 20B. */
export function sizeBand(params: Record<string, number>): "S" | "M" | "L" {
  const b = paramCount(params) / 1e9;
  return b < 7 ? "S" : b <= 20 ? "M" : "L";
}

/** maxPrice 0 = any; maker = the Hugging Face owner ("" = any); sort "cheap" re-sorts, other sorts keep the rows' order. */
export type ModelFilter = { size: "" | "S" | "M" | "L"; maxPrice: number; maker: string; thinking: boolean; images: boolean; hideGated: boolean; sort: string };

/** The model list under the filters. price = $/hr on the model's recommended GPU, null = no GPU can run it. */
export function filterModels<R extends Model & { gated?: unknown; thinks?: boolean; price: number | null }>(rows: R[], f: ModelFilter) {
  const ok = (r: R) =>
    (!f.size || sizeBand(r.params) === f.size) &&
    (!f.maxPrice || (r.price != null && r.price <= f.maxPrice)) &&
    (!f.maker || r.id.split("/")[0] === f.maker) &&
    (!f.thinking || !!r.thinks) &&
    (!f.images || seesImages(r)) &&
    (!f.hideGated || !r.gated);
  const price = (r: R) => r.price ?? Infinity;
  return rows.filter(ok).sort((a, b) => (f.sort === "cheap" && price(a) !== price(b) ? price(a) - price(b) : 0));
}

export type HfReject = "not-chat" | "not-supported" | "gated" | "no-weights" | "no-template";

export function parseHfModel(info: HfInfo, hasToken: boolean): { ok: true; model: Model } | { ok: false; reason: HfReject } {
  const draws = info.pipeline_tag === "text-to-image";
  if (draws && !T2I_PIPES.includes(info.config?.diffusers?._class_name ?? "")) return { ok: false, reason: "not-supported" };
  if (!draws && !CHAT_TAGS.includes(info.pipeline_tag ?? "")) return { ok: false, reason: "not-chat" };
  if (info.gated && !hasToken) return { ok: false, reason: "gated" };
  if (!info.safetensors) return { ok: false, reason: "no-weights" };
  if (draws) return { ok: true, model: { id: info.id, params: info.safetensors.parameters, draws } };
  // base models carry no chat template; vLLM's /v1/chat/completions refuses them
  if (!info.config?.tokenizer_config?.chat_template && !info.config?.chat_template_jinja) return { ok: false, reason: "no-template" };
  const vision = info.pipeline_tag === "image-text-to-text";
  return { ok: true, model: { id: info.id, params: info.safetensors.parameters, ...(vision ? { vision } : {}) } };
}

// CUDA 13.0 build. The -cu129 tag crash-loops: its torchcodec wants libnvrtc.so.13 (spike 2026-10-22).
export const VLLM_IMAGE = "vllm/vllm-openai:v0.32.0";
// Picture models: vLLM-Omni, built on vllm-openai v0.30.0; booted with minCudaVersion 13.0 on the 2026-10-23 spike.
export const OMNI_IMAGE = "vllm/vllm-omni:v0.30.0";
/** The server image a model's pods run. */
export const imageOf = (m: Model) => (m.draws ? OMNI_IMAGE : VLLM_IMAGE);

/** Recommended model storage (the network volume, or the container disk without one): the model files plus 10% and
 * 5 GB for vLLM's compile cache; rounded up to 5 GB, at least RunPod's 10 GB volume floor. */
export const diskGb = (params: Record<string, number>, draws = false) =>
  // a picture repo also holds its text encoder and VAE: Z-Image-Turbo downloaded 31 GB for 12.3 GB of transformer (spike).
  // ponytail: ×2.5 from that one repo; a repo that ships extra single-file copies may need more, raise it then
  Math.max(10, Math.ceil(((draws ? weightsGb(params) * 2.5 + 10 : weightsGb(params) * 1.1 + 5)) / 5) * 5);

/** A network volume costs $0.07/GB/month under 1 TB, on or off (docs.runpod.io/pods/pricing, 2026-10-22). */
export const volumePerMo = (gb: number) => gb * 0.07;

/**
 * Where to keep a model's network volume: the data center with the most stock of this GPU, inside the location's
 * ids (if any), that offers STANDARD volumes. "" = nowhere (Community GPUs list no data centers).
 * ponytail: STANDARD only, the HIGH_PERFORMANCE tier's price isn't published; add it if stock is too thin.
 */
export function volumeDc(gpu: Gpu, locationIds: string[], dcs: DataCenter[]) {
  const ok = (id: string) =>
    (!locationIds.length || locationIds.includes(id)) && !!dcs.find((d) => d.id === id)?.networkVolumeTypes?.includes("STANDARD");
  const here = (gpu.dataCenters ?? []).filter((d) => d.availability !== "NONE" && ok(d.id));
  return here.sort((a, b) => STOCK_RANK.indexOf(b.availability) - STOCK_RANK.indexOf(a.availability))[0]?.id ?? "";
}

/** Minutes of GPU time a per-run budget buys; 0 = no budget. */
export const budgetMin = (budget: number | undefined, pricePerHr: number | undefined) =>
  budget && pricePerHr ? Math.floor((budget / pricePerHr) * 60) : 0;

/** What a pod that never turns itself off costs. */
export const allDay = (pricePerHr: number) => ({ day: pricePerHr * 24, month: pricePerHr * 730 });

/** A storage size someone typed: rounded up to 5 GB, never below the recommendation. */
export const fitDisk = (gb: number, params: Record<string, number>, draws = false) => Math.max(diskGb(params, draws), Math.ceil(gb / 5) * 5 || 0);

const slug = (id: string) => id.split("/").pop()!.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
/** hose-qwen3-8b: the name of a model's pods and network volume. */
export const hoseName = (id: string) => `hose-${slug(id)}`;

/**
 * POST /v2/pods body. The watchdog script rides along in env and starts next to vLLM; it deletes the Pod after
 * idleMin quiet minutes (0 = never) or maxMin minutes on (0 = no budget), so a forgotten model stops billing even
 * with Hose closed. The model and vLLM's compile cache go to /workspace: on a network volume they outlive the Pod.
 */
export function podInput(
  model: Model,
  gpuId: string,
  cloud: Cloud,
  hfToken: string,
  apiKey: string,
  idleMin: number,
  watchdog: string,
  disk = diskGb(model.params, model.draws),
  dataCenterIds: string[] = [],
  maxMin = 0,
  volumeId = "",
) {
  return {
    name: hoseName(model.id),
    image: imageOf(model),
    gpu: { id: gpuId, count: 1, minCudaVersion: "13.0" },
    cloud,
    ...(dataCenterIds.length ? { dataCenterIds } : {}),
    // with a volume the container disk is scratch only; without one it holds the model too
    ...(volumeId ? { disk: 20, mounts: { network: [{ volumeId, path: "/workspace" }] } } : { disk: disk + 20 }),
    ports: ["8000/http"],
    env: {
      MODEL: model.id,
      HOSE_KEY: apiKey,
      HOSE_IDLE_MIN: String(idleMin),
      HOSE_MAX_MIN: String(maxMin),
      HOSE_WATCHDOG: watchdog,
      HF_HOME: "/workspace/hf",
      VLLM_CACHE_ROOT: "/workspace/vllm",
      ...(hfToken ? { HF_TOKEN: hfToken } : {}),
    },
    entrypoint: [
      "bash",
      "-c",
      // no exec: if vLLM dies the container stays up and this watchdog deletes the pod. A container restart would
      // start a fresh watchdog with a fresh boot timer, so a crash loop could bill forever.
      `python3 -c "$HOSE_WATCHDOG" & vllm serve "$MODEL" ${model.draws ? "--omni " : ""}--port 8000 --api-key "$HOSE_KEY"${model.draws ? "" : " --max-model-len auto"}; sleep infinity`,
    ],
  };
}

/** JSON payload of every `data:` line in raw SSE (complete lines only); `[DONE]` skipped. */
export const sseData = (raw: string): any[] =>
  raw
    .split("\n")
    .filter((l) => l.startsWith("data: ") && l !== "data: [DONE]")
    .map((l) => JSON.parse(l.slice(6)));

export type Usage = { prompt_tokens: number; completion_tokens: number };

/**
 * Qwen-style models write their reasoning as `<think>…</think>` before the answer. While it streams, an open
 * `<think>` is all thinking. Some templates (Qwen3.5) open it in the prompt, so only `</think>` shows up:
 * `open` says thinking was asked for, so text before any `</think>` is thinking so far.
 */
export function splitThink(text: string, open = false) {
  const close = text.indexOf("</think>");
  const opened = text.trimStart().startsWith("<think>");
  if (close < 0 && !opened && !open) return { thinking: "", content: text };
  const start = opened ? text.indexOf("<think>") + 7 : 0;
  if (close < 0) return { thinking: text.slice(start).trim(), content: "" };
  return { thinking: text.slice(start, close).trim(), content: text.slice(close + 8).trimStart() };
}

/**
 * The reply carried by OpenAI-style SSE from vLLM /v1/chat/completions with stream: true: the answer, the reasoning
 * (`<think>` tags in the text, or a separate reasoning field as gpt-oss sends it) and the token usage (last chunk).
 * `open` while streaming a thinking reply; leave it off for the finished stream, so a model with no thinking mode
 * (no `</think>` ever came) gets its text back as the answer.
 */
export function sseReply(raw: string, open = false) {
  const chunks = sseData(raw);
  const delta = (d: any) => d.choices?.[0]?.delta ?? {};
  const reasoning = chunks.map((d) => delta(d).reasoning ?? delta(d).reasoning_content ?? "").join("");
  const { thinking, content } = splitThink(chunks.map((d) => delta(d).content ?? "").join(""), open && !reasoning);
  const usage: Usage | undefined = chunks.filter((d) => d.usage).at(-1)?.usage;
  return { content, thinking: reasoning + thinking, ...(usage ? { usage } : {}) };
}

/** The muted line under a reply: "12 in · 96 out · 40 tok/s · 0.4 s to first token". */
export function replyStats(usage: Usage, firstMs: number, genMs: number) {
  const speed = genMs > 0 ? [`${Math.round(usage.completion_tokens / (genMs / 1000))} tok/s`] : [];
  return [`${usage.prompt_tokens} in`, `${usage.completion_tokens} out`, ...speed, `${(firstMs / 1000).toFixed(1)} s to first token`].join(" · ");
}

/**
 * vLLM /metrics read like the on-pod watchdog does: requests running + waiting, and requests finished so far.
 * A picture pod (vLLM-Omni) has its own names and no success counter; its latency histogram counts finished requests.
 */
export function vllmLoad(text: string) {
  const total = (name: string) =>
    [...text.matchAll(new RegExp(`^${name}(?:\\{[^}]*\\})? (\\S+)`, "gm"))].reduce((sum, m) => sum + Number(m[1]), 0);
  const busy = ["vllm:num_requests_running", "vllm:num_requests_waiting", "vllm_omni:num_requests_running", "vllm_omni:num_requests_waiting"];
  return { busy: busy.reduce((sum, n) => sum + total(n), 0), done: total("vllm:request_success_total") + total("vllm_omni:e2e_request_latency_s_count") };
}

// ponytail: covers tqdm (\r-separated updates) and colour codes; other terminal escapes pass through as-is
/** A pod log line as a person reads it: the last progress update, no colour codes. */
export const logText = (line: string) =>
  (line.split("\r").filter((s) => s.trim()).pop() ?? "").replace(/\x1b\[[0-9;]*m/g, "").trim();

/**
 * A healthy pod logs "create container" / "Pulling image" within seconds. None after 3 min means RunPod's host never
 * started it (status still says RUNNING): worth another machine. The watchdog can't help, it never started either.
 */
export const stuckBoot = (createdAt: string | undefined, now: number, lines: number) =>
  !lines && !!createdAt && now - Date.parse(createdAt) > 3 * 60000;

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
  idleMin: number; // 0 = never
  budget?: number; // $ per run, then it turns off; unset or 0 = no limit
  price?: number; // $/hr when it was picked, for "Costs when on"
  vram?: number; // GPU memory in GB, from the catalog when it was picked
  disk?: number; // container disk in GB; unset = diskGb(params)
  location?: string; // "" or unset = anywhere; a region (EUROPE) or a data center id (EU-RO-1)
  podId?: string;
  volumeId?: string; // network volume keeping the model between runs (Secure only); billed until removed
  volumeDc?: string; // its data center: pods that mount it must run there
  volumeGb?: number;
  pastPodIds: string[];
  spentPast: number; // ≈ $ of finished runs
  last?: Last;
  think?: boolean; // chat: ask the model to reason first
  log?: boolean; // chat: server log panel under the messages
};

/** A new config for a model on a GPU card: Secure, off after 10 quiet minutes, the recommended storage. over = the user's choices. */
export const newConfig = (m: Model, g: GpuCard, over: Partial<Config> = {}): Config => ({
  key: crypto.randomUUID(),
  name: `${label(m.id)} · ${g.name}`,
  id: m.id,
  params: m.params,
  vision: m.vision,
  draws: m.draws,
  gpuId: g.id,
  gpuName: g.name,
  cloud: "SECURE",
  disk: diskGb(m.params, m.draws),
  idleMin: 10,
  price: g.price,
  vram: g.memory,
  pastPodIds: [],
  spentPast: 0,
  ...over,
});

/** Change GPU: the config's next pod runs on g. An auto name follows the GPU. */
export function moveTo(c: Config, g: GpuCard, cloud = c.cloud, location = c.location) {
  if (c.name === `${label(c.id)} · ${c.gpuName}`) c.name = `${label(c.id)} · ${g.name}`;
  Object.assign(c, { gpuId: g.id, gpuName: g.name, cloud, location: location || undefined, price: g.price, vram: g.memory });
}

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

const dollars = (n: number) => (Number.isInteger(n) ? `$${n}` : usd(n));

/** When a config's pod turns itself off: "after 10 quiet min", "at $5 a run", both, or "never: on 24/7". */
export function offText(c: { idleMin: number; budget?: number }) {
  const idle = c.idleMin ? `after ${c.idleMin} quiet min` : "";
  const cap = c.budget ? `${dollars(c.budget)} a run` : "";
  if (idle && cap) return `${idle} or ${cap}`;
  return idle || (cap ? `at ${cap}` : "never: on 24/7");
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
export const billions = (params: Record<string, number>) => `${(paramCount(params) / 1e9).toFixed(1)}B`;
