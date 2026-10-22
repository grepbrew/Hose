// Fake RunPod + Hugging Face. Shared by vitest (msw/node) and the screen tests (vite dev with VITE_MOCK=1).
// Response shapes follow the examples in api.runpod.io/v2/openapi.json and the 2026-10-22 pod spike.
import { http, HttpResponse } from "msw/http";

const REST = "https://api.runpod.io/v2";

type Pod = { id: string; name: string; status: string; cost: number };
export const state = {
  pods: [] as Pod[],
  checks: {} as Record<string, number>, // readiness checks seen per pod; a new pod turns ready on the second
  n: 0,
};

/** Screen-test preconditions, picked with `?seed=` in mock mode. Saved models are seeded by main.ts. */
export function seed(name: string | null) {
  state.pods = [];
  state.checks = {};
  if (name === "on") {
    state.pods.push({ id: "pod1", name: "hose-qwen3-8b", status: "RUNNING", cost: 0.89 });
    state.checks.pod1 = 1;
  }
}

const gpu = (name: string, memory: number, secure: number | null, community: number | null, availability = "HIGH") => ({
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
});
export const GPUS = [
  gpu("RTX A4000", 16, 0.25, 0.17),
  gpu("RTX A5000", 24, 0.27, 0.16, "NONE"),
  gpu("RTX 4090", 24, 0.89, 0.59),
  gpu("A40", 48, 0.59, null),
  gpu("A100 PCIe", 80, 1.79, 1.19, "LOW"),
];

const denied = (request: Request) => request.headers.get("Authorization") !== "Bearer good-key";
const unauthorized = () => new HttpResponse("Unauthorized", { status: 401 });
const podId = (request: Request) => new URL(request.url).hostname.split("-8000.")[0];

// vLLM's OpenAI stream, cut mid-line on purpose so the client has to buffer partial lines
const SSE = [
  'data: {"choices":[{"index":0,"delta":{"role":"assistant","content":""}}]}\n\ndata: {"choices":[{"index":0,"delta":{"content":"Hello "}}]}\n\ndata: {"choi',
  'ces":[{"index":0,"delta":{"content":"from fake "}}]}\n\ndata: {"choices":[{"index":0,"delta":{"content":"GPU"}}]}\n\n',
  'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
];

export const handlers = [
  http.post("https://api.runpod.io/graphql", async ({ request }) => {
    if (denied(request)) return unauthorized();
    const { query } = (await request.json()) as { query: string };
    if (query.includes("myself")) return HttpResponse.json({ data: { myself: { clientBalance: 25 } } });
    return HttpResponse.json({ errors: [{ message: "unknown query" }] });
  }),
  http.get(`${REST}/catalog/gpus`, ({ request }) => (denied(request) ? unauthorized() : HttpResponse.json({ gpus: GPUS }))),
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
    const { name } = (await request.json()) as { name: string };
    const pod = { id: `pod${++state.n + 1}`, name, status: "RUNNING", cost: 0.89 };
    state.pods.push(pod);
    return HttpResponse.json(pod, { status: 201 });
  }),
  http.delete(`${REST}/pods/:id`, ({ params }) => {
    state.pods = state.pods.filter((p) => p.id !== params.id);
    return new HttpResponse(null, { status: 204 });
  }),
  http.get("https://*.proxy.runpod.net/v1/models", ({ request }) => {
    const id = podId(request);
    const seen = (state.checks[id] = (state.checks[id] ?? 0) + 1);
    const ready = state.pods.some((p) => p.id === id) && seen > 1;
    return ready ? HttpResponse.json({ object: "list", data: [{ id: "Qwen/Qwen3-8B" }] }) : new HttpResponse("Not Found", { status: 404 });
  }),
  http.post("https://*.proxy.runpod.net/v1/chat/completions", () => {
    const enc = new TextEncoder();
    const body = new ReadableStream({
      start(c) {
        SSE.forEach((s) => c.enqueue(enc.encode(s)));
        c.close();
      },
    });
    return new HttpResponse(body, { headers: { "Content-Type": "text/event-stream" } });
  }),
  http.get("https://huggingface.co/api/whoami-v2", () => HttpResponse.json({ name: "tester" })),
  http.get("https://huggingface.co/api/models/:org/:name", ({ params }) =>
    HttpResponse.json(
      params.name === "FLUX.1-schnell"
        ? { pipeline_tag: "text-to-image", gated: false, safetensors: { parameters: { BF16: 11.9e9 } } }
        : { pipeline_tag: "text-generation", gated: false, safetensors: { parameters: { BF16: 8e9 } } },
    ),
  ),
];
