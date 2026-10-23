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
  calls: [] as string[], // writes in order: "create", "create full", "delete pod1", "volume create US-TX-3", "volume resize vol1 50", "volume delete vol1"
  volumes: [] as { id: string; name: string; size: number; dataCenter: string; type: string }[],
  full: false, // the volume's data center has no free GPU: a pod with a network mount gets 400
  silent: "", // a pod RunPod's host never started: its log stream has no lines (seed stuck)
  lastChat: null as Record<string, any> | null, // last POST /v1/chat/completions body
  served: 0, // vLLM's finished-request count in /metrics
  soldOut: false, // every GPU's stock NONE (seed soldOut)
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
  state.calls = [];
  state.volumes = [];
  state.full = false;
  state.silent = "";
  state.lastChat = null;
  state.served = 0;
  state.soldOut = name === "soldOut";
  if (name === "presetOff" || name === "seeOn") state.volumes.push({ id: "vol1", name: "hose-qwen3-5-9b", size: 30, dataCenter: "US-TX-3", type: "STANDARD" });
  if (name === "stored" || name === "storedOn") state.volumes.push({ id: "vol1", name: "hose-qwen3-8b", size: 25, dataCenter: "US-TX-3", type: "STANDARD" });
  if (name === "on" || name === "two" || name === "storedOn") {
    state.pods.push(pod("pod1", "hose-qwen3-8b", "NVIDIA RTX 4090", 0.89, 21));
    state.checks.pod1 = 1;
  }
  if (name === "seeOn") {
    state.pods.push(pod("pod1", "hose-qwen3-5-9b", "NVIDIA A40", 0.59, 21));
    state.checks.pod1 = 1;
  }
  if (name === "stuck") {
    state.pods.push(pod("pod1", "hose-qwen3-8b", "NVIDIA RTX 4090", 0.89, 5));
    state.booting = state.silent = "pod1";
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

// GET /api/models?search= with expand[]: id, pipeline_tag, downloads, gated, safetensors, config (live shape 2026-10-23)
const CHAT_CONFIG = { tokenizer_config: { chat_template: "{{ messages }}" } };
// a template with a thinking switch, as Qwen3 and the DeepSeek-R1 distills carry
const THINK_CONFIG = { tokenizer_config: { chat_template: "{{ messages }}{% if enable_thinking %}<think>\n{% endif %}" } };
const hfModel = (id: string, pipeline_tag: string | null, downloads: number, params: number | null, gated: boolean | string = false, config: object = CHAT_CONFIG) => ({
  id,
  pipeline_tag,
  downloads,
  gated,
  config,
  ...(params ? { safetensors: { parameters: { BF16: params }, total: params } } : {}),
});
// the live API sends config (tokenizer_config.chat_template, chat_template_jinja) only for expand[]=config
const expand = <T extends { config?: object }>(request: Request, { config, ...m }: T) =>
  new URL(request.url).searchParams.getAll("expand[]").includes("config") ? { ...m, config } : m;
const HF_MODELS = [
  hfModel("deepseek-ai/DeepSeek-R1-Distill-Qwen-7B", "text-generation", 1316000, 7615616512, false, THINK_CONFIG),
  hfModel("deepseek-ai/DeepSeek-OCR", "image-text-to-text", 2092524, 3336106240, false, {}), // live: no chat template
  hfModel("antirez/deepseek-v4.1-flash-gguf", null, 1420082, null),
  hfModel("deepseek-ai/Janus-Pro-7B", "any-to-any", 90000, 7420000000),
  hfModel("black-forest-labs/FLUX.1-schnell", "text-to-image", 700000, 11.9e9),
  hfModel("Qwen/Qwen3-8B", "text-generation", 9100000, 8190735360, false, THINK_CONFIG),
  hfModel("Qwen/Qwen3-Embedding-0.6B", "feature-extraction", 5200000, 595776512),
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
  'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
  'data: {"choices":[],"usage":{"prompt_tokens":9,"total_tokens":12,"completion_tokens":3}}\n\ndata: [DONE]\n\n',
];

// with enable_thinking, as a real Qwen3.5 pod sends it: the template opens <think> in the prompt, so the content is
// the reasoning, then </think>, then the answer
// user sends "md": a markdown reply (bold, list, code, math), then the usual stop + usage
const MD = "**Bold text** and a list:\n\n- one\n- two\n\n```ts\nconst a = 1\n```\n\nArea is $x^2$.";
const SSE_MD = [`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: MD } }] })}\n\n`, ...SSE.slice(2)];

// the last message carries images (OpenAI image_url parts): say how many arrived
const SSE_SEEN = (n: number) => [`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: `I see ${n} image${n > 1 ? "s" : ""}.` } }] })}\n\n`, ...SSE.slice(2)];

const SSE_THINK = [
  'data: {"choices":[{"index":0,"delta":{"content":"The user says hi."}}]}\n\n',
  'data: {"choices":[{"index":0,"delta":{"content":"\\n</think>\\n\\n"}}]}\n\n',
  ...SSE,
];

// vLLM /metrics, only the lines Hose and the watchdog read
const metrics = (done: number) =>
  [
    'vllm:num_requests_running{engine="0",model_name="Qwen/Qwen3-8B"} 0.0',
    'vllm:num_requests_waiting{engine="0",model_name="Qwen/Qwen3-8B"} 0.0',
    `vllm:request_success_total{engine="0",finished_reason="stop",model_name="Qwen/Qwen3-8B"} ${done}.0`,
    'vllm:request_success_total{engine="0",finished_reason="length",model_name="Qwen/Qwen3-8B"} 0.0',
  ].join("\n") + "\n";

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
          gpus: (state.soldOut ? GPUS.map((g) => ({ ...g, availability: "NONE", dataCenters: g.dataCenters?.map((d) => ({ ...d, availability: "NONE" })) })) : GPUS).map((g) =>
            new URL(request.url).searchParams.get("cloud") === "COMMUNITY" ? (({ dataCenters, ...rest }) => rest)(g) : g,
          ),
        }),
  ),
  http.get(`${REST}/catalog/datacenters`, ({ request }) =>
    denied(request)
      ? unauthorized()
      : HttpResponse.json({
          dataCenters: [
            { id: "US-TX-3", name: "US Texas 3", region: "NORTH_AMERICA", networkVolumeTypes: ["STANDARD"], compliance: [], globalNetwork: true },
            { id: "EU-RO-1", name: "EU Romania 1", region: "EUROPE", networkVolumeTypes: ["HIGH_PERFORMANCE"], compliance: [], globalNetwork: false },
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
    const body = (await request.json()) as Record<string, any>;
    if (state.full && body.mounts?.network) {
      state.calls.push("create full");
      return HttpResponse.json(
        { detail: "There are no longer any instances available with the requested specifications. Please refresh and try again.", status: 400, title: "Bad Request" },
        { status: 400 },
      );
    }
    state.lastCreate = body;
    const name = state.lastCreate.name as string;
    const created = pod(`pod${++state.n + 1}`, name, "NVIDIA RTX 4090", 0.89);
    state.pods.push(created);
    state.calls.push("create");
    return HttpResponse.json(created, { status: 201 });
  }),
  http.delete(`${REST}/pods/:id`, ({ params }) => {
    state.pods = state.pods.filter((p) => p.id !== params.id);
    state.calls.push(`delete ${params.id}`);
    return new HttpResponse(null, { status: 204 });
  }),
  // network volumes (openapi /v2/network-volumes; live shape 2026-10-22: {id, name, size, dataCenter, type})
  http.post(`${REST}/network-volumes`, async ({ request }) => {
    if (denied(request)) return unauthorized();
    const b = (await request.json()) as { name: string; size: number; dataCenter: string; type: string };
    const v = { id: `vol${state.volumes.length + 2}`, name: b.name, size: b.size, dataCenter: b.dataCenter, type: b.type ?? "STANDARD" };
    state.volumes.push(v);
    state.calls.push(`volume create ${b.dataCenter}`);
    return HttpResponse.json(v, { status: 201 });
  }),
  http.patch(`${REST}/network-volumes/:id`, async ({ request, params }) => {
    const v = state.volumes.find((x) => x.id === params.id);
    if (!v) return new HttpResponse("Not Found", { status: 404 });
    v.size = ((await request.json()) as { size: number }).size;
    state.calls.push(`volume resize ${v.id} ${v.size}`);
    return HttpResponse.json(v);
  }),
  http.delete(`${REST}/network-volumes/:id`, ({ params }) => {
    state.volumes = state.volumes.filter((v) => v.id !== params.id);
    state.calls.push(`volume delete ${params.id}`);
    return new HttpResponse(null, { status: 204 });
  }),
  http.get("https://*.proxy.runpod.net/v1/models", ({ request }) => {
    const id = podId(request);
    const seen = (state.checks[id] = (state.checks[id] ?? 0) + 1);
    const ready = state.pods.some((p) => p.id === id) && seen > 1 && id !== state.booting;
    return ready ? HttpResponse.json({ object: "list", data: [{ id: "Qwen/Qwen3-8B" }] }) : new HttpResponse("Not Found", { status: 404 });
  }),
  // a reconnect (since=) has nothing new, so the client's retry loop adds no duplicates
  http.get(`${REST}/pods/:id/logs`, ({ request, params }) =>
    denied(request) ? unauthorized() : sse(new URL(request.url).searchParams.has("since") || state.silent === params.id ? [] : LOGS),
  ),
  http.post("https://*.proxy.runpod.net/v1/chat/completions", async ({ request }) => {
    state.lastChat = (await request.json()) as Record<string, any>;
    const id = podId(request);
    if (id === "broken") return new HttpResponse("Internal Server Error", { status: 500 });
    // pod "mute": vLLM finishes without a word (stop + usage + [DONE] only)
    if (id === "mute") return sse(SSE.slice(2));
    const last = state.lastChat.messages.at(-1)?.content;
    if (last === "md") return sse(SSE_MD);
    if (Array.isArray(last)) return sse(SSE_SEEN(last.filter((p: { type: string }) => p.type === "image_url").length));
    return sse(state.lastChat.chat_template_kwargs?.enable_thinking ? SSE_THINK : SSE);
  }),
  http.get("https://*.proxy.runpod.net/metrics", () => HttpResponse.text(metrics(state.served))),
  http.get("https://huggingface.co/api/whoami-v2", () => HttpResponse.json({ name: "tester" })),
  // like the live API: search matches the repo id, author the owner, sort=downloads is most downloaded first
  http.get("https://huggingface.co/api/models", ({ request }) => {
    const p = new URL(request.url).searchParams;
    const q = (p.get("search") ?? "").toLowerCase();
    const found = HF_MODELS.filter((m) => m.id.toLowerCase().includes(q) && (!p.get("author") || m.id.startsWith(`${p.get("author")}/`)));
    if (p.get("sort") === "downloads") found.sort((a, b) => b.downloads - a.downloads);
    return HttpResponse.json(found.map((m) => expand(request, m)));
  }),
  // gated-model licence check (hfCanDownload)
  http.head("https://huggingface.co/:org/:name/resolve/main/config.json", () => new HttpResponse(null, { status: 200 })),
  http.get("https://huggingface.co/api/models/:org/:name", ({ params, request }) =>
    params.name === "missing"
      ? new HttpResponse(null, { status: 404 })
      : HttpResponse.json(
          expand(
            request,
            params.name === "FLUX.1-schnell"
              ? { pipeline_tag: "text-to-image", gated: false, safetensors: { parameters: { BF16: 11.9e9 } }, config: {} }
              : { pipeline_tag: "text-generation", gated: false, safetensors: { parameters: { BF16: 8e9 } }, config: CHAT_CONFIG },
          ),
        ),
  ),
];
