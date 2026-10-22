// Fake RunPod + Hugging Face. Shared by vitest (msw/node) and the screen tests (vite dev with VITE_MOCK=1).
// Response shapes follow the examples in api.runpod.io/v2/openapi.json and the 2026-10-22 pod spike.
import { http, HttpResponse } from "msw/http";

const REST = "https://api.runpod.io/v2";

type Pod = { id: string; name: string; status: string; cost: number } & Record<string, unknown>;
export const state = {
  pods: [] as Pod[],
  checks: {} as Record<string, number>, // readiness checks seen per pod; a new pod turns ready on the second
  n: 0,
  booting: "", // a pod that never turns ready (seed starting)
  lastCreate: null as Record<string, unknown> | null, // last POST /v2/pods body
};

// Fields a running GPU pod carries in GET /v2/pods (Pod schema in api.runpod.io/v2/openapi.json).
const pod = (id: string, name: string, gpuId: string, cost: number, minutesAgo = 0): Pod => {
  const at = new Date(Date.now() - minutesAgo * 60000).toISOString();
  return {
    id,
    name,
    status: "RUNNING",
    cost,
    cloud: "SECURE",
    dataCenterId: "US-TX-3",
    image: "vllm/vllm-openai:v0.32.0",
    disk: 45,
    gpu: { id: gpuId, count: 1, vcpuCount: 16, memory: 62 },
    createdAt: at,
    startedAt: at,
    runtime: { uptime: minutesAgo * 60 },
  };
};

/** Screen-test preconditions, picked with `?seed=` in mock mode. Saved models are seeded by main.ts. */
export function seed(name: string | null) {
  state.pods = [];
  state.checks = {};
  state.booting = "";
  state.lastCreate = null;
  if (name === "on" || name === "two") {
    state.pods.push(pod("pod1", "hose-qwen3-8b", "NVIDIA RTX 4090", 0.89, 21));
    state.checks.pod1 = 1;
  }
  if (name === "starting") {
    state.pods.push(pod("pod1", "hose-qwen3-8b", "NVIDIA RTX 4090", 0.89, 1));
    state.booting = "pod1";
  }
  if (name === "stray") {
    state.pods.push(pod("pod9", "hose-llama-3-1-8b-instruct", "NVIDIA RTX 4090", 0.89, 5));
    state.checks.pod9 = 1;
  }
}

// GET /api/models?search= with expand[]: id, pipeline_tag, downloads, gated, safetensors (live shape 2026-10-22)
const hfModel = (id: string, pipeline_tag: string | null, downloads: number, params: number | null, gated: boolean | string = false) => ({
  id,
  pipeline_tag,
  downloads,
  gated,
  ...(params ? { safetensors: { parameters: { BF16: params }, total: params } } : {}),
});
const HF_MODELS = [
  hfModel("deepseek-ai/DeepSeek-R1-Distill-Qwen-7B", "text-generation", 1316000, 7615616512),
  hfModel("deepseek-ai/DeepSeek-OCR", "image-text-to-text", 2092524, 3336106240),
  hfModel("antirez/deepseek-v4.1-flash-gguf", null, 1420082, null),
  hfModel("deepseek-ai/Janus-Pro-7B", "any-to-any", 90000, 7420000000),
  hfModel("black-forest-labs/FLUX.1-schnell", "text-to-image", 700000, 11.9e9),
];

const gpu = (name: string, memory: number, secure: number | null, community: number | null, availability = "HIGH", dataCenters: [string, string][] = []) => ({
  id: `NVIDIA ${name}`,
  name,
  pool: null,
  manufacturer: "NVIDIA",
  memory,
  secure: secure !== null,
  community: community !== null,
  price: { secure, community, serverless: null },
  maxCount: { secure: 8, community: 8 },
  availability,
  // per data center stock; live, only cloud=SECURE fills this (2026-10-22)
  ...(dataCenters.length ? { dataCenters: dataCenters.map(([id, availability]) => ({ id, name: id, availability })) } : {}),
});
export const GPUS = [
  gpu("RTX A4000", 16, 0.25, 0.17, "HIGH", [["US-TX-3", "HIGH"]]),
  gpu("RTX A5000", 24, 0.27, 0.16, "NONE"),
  gpu("RTX 4090", 24, 0.89, 0.59, "HIGH", [["US-TX-3", "HIGH"], ["EU-RO-1", "LOW"]]),
  gpu("A40", 48, 0.59, null, "HIGH", [["EU-RO-1", "MEDIUM"]]),
  gpu("A100 PCIe", 80, 1.79, 1.19, "LOW", [["EU-RO-1", "LOW"]]),
];

const denied = (request: Request) => request.headers.get("Authorization") !== "Bearer good-key";
const unauthorized = () => new HttpResponse("Unauthorized", { status: 401 });
const podId = (request: Request) => new URL(request.url).hostname.split("-8000.")[0];

const sse = (chunks: string[]) => {
  const enc = new TextEncoder();
  const body = new ReadableStream({
    start(c) {
      chunks.forEach((s) => c.enqueue(enc.encode(s)));
      c.close();
    },
  });
  return new HttpResponse(body, { headers: { "Content-Type": "text/event-stream" } });
};

// vLLM's OpenAI stream, cut mid-line on purpose so the client has to buffer partial lines
const SSE = [
  'data: {"choices":[{"index":0,"delta":{"role":"assistant","content":""}}]}\n\ndata: {"choices":[{"index":0,"delta":{"content":"Hello "}}]}\n\ndata: {"choi',
  'ces":[{"index":0,"delta":{"content":"from fake "}}]}\n\ndata: {"choices":[{"index":0,"delta":{"content":"GPU"}}]}\n\n',
  'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
];

// GET /v2/pods/{id}/logs (openapi example shape): image pull, then vLLM with a colour code and a tqdm \r line; cut mid-line
const LOGS = [
  'id: 2026-10-22T10:00:01Z/000000000001\ndata: {"ts":"2026-10-22T10:00:01Z","source":"system","line":"Pulling image vllm/vllm-openai:v0.32.0"}\n\nid: 2026-10-22T10:00:40Z/000000000002\ndata: {"ts":"2026-10-22T10:00:40Z","source":"cont',
  'ainer","line":"\\u001b[32mINFO\\u001b[0m Starting vLLM API server"}\n\nid: 2026-10-22T10:00:52Z/000000000003\ndata: {"ts":"2026-10-22T10:00:52Z","source":"container","line":"Downloading 10%\\rDownloading 100%"}\n\n',
  'id: 2026-10-22T10:01:30Z/000000000004\ndata: {"ts":"2026-10-22T10:01:30Z","source":"container","line":"Loading weights took 12.3 seconds"}\n\n',
];

export const handlers = [
  http.post("https://api.runpod.io/graphql", async ({ request }) => {
    if (denied(request)) return unauthorized();
    const { query } = (await request.json()) as { query: string };
    if (query.includes("myself")) return HttpResponse.json({ data: { myself: { clientBalance: 25 } } });
    return HttpResponse.json({ errors: [{ message: "unknown query" }] });
  }),
  // live API: only cloud=SECURE carries per data center stock
  http.get(`${REST}/catalog/gpus`, ({ request }) =>
    denied(request)
      ? unauthorized()
      : HttpResponse.json({
          gpus: new URL(request.url).searchParams.get("cloud") === "COMMUNITY" ? GPUS.map(({ dataCenters, ...g }) => g) : GPUS,
        }),
  ),
  http.get(`${REST}/catalog/datacenters`, ({ request }) =>
    denied(request)
      ? unauthorized()
      : HttpResponse.json({
          dataCenters: [
            { id: "US-TX-3", name: "US Texas 3", region: "NORTH_AMERICA", networkVolumeTypes: [], compliance: [], globalNetwork: true },
            { id: "EU-RO-1", name: "EU Romania 1", region: "EUROPE", networkVolumeTypes: [], compliance: [], globalNetwork: false },
          ],
        }),
  ),
  http.get(`${REST}/pods`, ({ request }) =>
    denied(request)
      ? unauthorized()
      : HttpResponse.json({
          pods: [...state.pods, { id: "other", name: "someone-else", status: "RUNNING", cost: 0.44 }],
          pagination: { nextCursor: null, hasNextPage: false },
        }),
  ),
  http.post(`${REST}/pods`, async ({ request }) => {
    if (denied(request)) return unauthorized();
    state.lastCreate = (await request.json()) as Record<string, unknown>;
    const name = state.lastCreate.name as string;
    const created = pod(`pod${++state.n + 1}`, name, "NVIDIA RTX 4090", 0.89);
    state.pods.push(created);
    return HttpResponse.json(created, { status: 201 });
  }),
  http.delete(`${REST}/pods/:id`, ({ params }) => {
    state.pods = state.pods.filter((p) => p.id !== params.id);
    return new HttpResponse(null, { status: 204 });
  }),
  http.get("https://*.proxy.runpod.net/v1/models", ({ request }) => {
    const id = podId(request);
    const seen = (state.checks[id] = (state.checks[id] ?? 0) + 1);
    const ready = state.pods.some((p) => p.id === id) && seen > 1 && id !== state.booting;
    return ready ? HttpResponse.json({ object: "list", data: [{ id: "Qwen/Qwen3-8B" }] }) : new HttpResponse("Not Found", { status: 404 });
  }),
  // a reconnect (since=) has nothing new, so the client's retry loop adds no duplicates
  http.get(`${REST}/pods/:id/logs`, ({ request }) =>
    denied(request) ? unauthorized() : sse(new URL(request.url).searchParams.has("since") ? [] : LOGS),
  ),
  http.post("https://*.proxy.runpod.net/v1/chat/completions", () => sse(SSE)),
  http.get("https://huggingface.co/api/whoami-v2", () => HttpResponse.json({ name: "tester" })),
  http.get("https://huggingface.co/api/models", ({ request }) => {
    const q = (new URL(request.url).searchParams.get("search") ?? "").toLowerCase();
    return HttpResponse.json(HF_MODELS.filter((m) => m.id.toLowerCase().includes(q)));
  }),
  // gated-model licence check (hfCanDownload)
  http.head("https://huggingface.co/:org/:name/resolve/main/config.json", () => new HttpResponse(null, { status: 200 })),
  http.get("https://huggingface.co/api/models/:org/:name", ({ params }) =>
    HttpResponse.json(
      params.name === "FLUX.1-schnell"
        ? { pipeline_tag: "text-to-image", gated: false, safetensors: { parameters: { BF16: 11.9e9 } } }
        : { pipeline_tag: "text-generation", gated: false, safetensors: { parameters: { BF16: 8e9 } } },
    ),
  ),
];
