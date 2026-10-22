// Fake RunPod + Hugging Face. Shared by vitest (msw/node) and the screen tests (vite dev with VITE_MOCK=1).
import { http, HttpResponse } from "msw/http";

const REST = "https://api.runpod.io/v2";
const RUN = "https://api.runpod.ai/v2";

type W = { id: string; gpuTypeId: string; gpuCount: number; status: string };
export const state = {
  endpoints: [] as { id: string; name: string }[],
  workers: {} as Record<string, W[]>,
  n: 0,
};

/** Screen-test preconditions, picked with `?seed=` in mock mode. */
export function seed(name: string | null) {
  state.endpoints = [];
  state.workers = {};
  if (name === "one" || name === "running") state.endpoints.push({ id: "ep1", name: "hose-qwen3-8b" });
  if (name === "running") state.workers.ep1 = [{ id: "w1", gpuTypeId: "NVIDIA GeForce RTX 4090", gpuCount: 1, status: "RUNNING" }];
}

export const GPUS = [
  { id: "NVIDIA RTX A4000", pool: "AMPERE_16", memory: 16, price: { serverless: 0.58 }, availability: "HIGH" },
  { id: "NVIDIA RTX A5000", pool: "AMPERE_24", memory: 24, price: { serverless: 0.69 }, availability: "HIGH" },
  { id: "NVIDIA GeForce RTX 4090", pool: "ADA_24", memory: 24, price: { serverless: 1.1 }, availability: "HIGH" },
  { id: "NVIDIA RTX A6000", pool: "AMPERE_48", memory: 48, price: { serverless: 1.22 }, availability: "HIGH" },
  { id: "NVIDIA A100 80GB PCIe", pool: "AMPERE_80", memory: 80, price: { serverless: 2.72 }, availability: "LOW" },
];

const denied = (request: Request) => request.headers.get("Authorization") !== "Bearer good-key";
const unauthorized = () => new HttpResponse("Unauthorized", { status: 401 });

export const handlers = [
  http.post("https://api.runpod.io/graphql", async ({ request }) => {
    if (denied(request)) return unauthorized();
    const { query, variables } = (await request.json()) as { query: string; variables?: { input: { name: string } } };
    if (query.includes("myself")) return HttpResponse.json({ data: { myself: { clientBalance: 25 } } });
    if (query.includes("saveEndpoint")) {
      const ep = { id: `ep${++state.n + 1}`, name: variables!.input.name };
      state.endpoints.push(ep);
      return HttpResponse.json({ data: { saveEndpoint: ep } });
    }
    return HttpResponse.json({ errors: [{ message: "unknown query" }] });
  }),
  http.get(`${REST}/catalog/gpus`, ({ request }) => (denied(request) ? unauthorized() : HttpResponse.json({ gpus: GPUS }))),
  http.get(`${REST}/serverless`, ({ request }) =>
    denied(request) ? unauthorized() : HttpResponse.json({ endpoints: [...state.endpoints, { id: "other", name: "someone-else" }] }),
  ),
  http.delete(`${REST}/serverless/:id`, ({ params }) => {
    state.endpoints = state.endpoints.filter((e) => e.id !== params.id);
    return new HttpResponse(null, { status: 204 });
  }),
  http.get(`${REST}/serverless/:id/workers`, ({ params }) => HttpResponse.json({ workers: state.workers[params.id as string] ?? [] })),
  http.get(`${REST}/billing/serverless`, () => HttpResponse.json({ records: [{ totalAmount: 0.12 }] })),
  http.post(`${RUN}/:id/run`, () => HttpResponse.json({ id: "job1", status: "IN_QUEUE" })),
  http.get(`${RUN}/:id/stream/:job`, () =>
    HttpResponse.json({ status: "COMPLETED", stream: [{ output: { choices: [{ tokens: ["Hello from fake GPU"] }] } }] }),
  ),
  http.get("https://huggingface.co/api/whoami-v2", () => HttpResponse.json({ name: "tester" })),
  http.get("https://huggingface.co/api/models/:org/:name", ({ params }) =>
    HttpResponse.json(
      params.name === "FLUX.1-schnell"
        ? { pipeline_tag: "text-to-image", gated: false, safetensors: { parameters: { BF16: 11.9e9 } } }
        : { pipeline_tag: "text-generation", gated: false, safetensors: { parameters: { BF16: 8e9 } } },
    ),
  ),
];
