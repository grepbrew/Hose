import { describe, it, expect } from "vitest";
import STREAM from "./fixtures/chat-stream.txt?raw";
import STREAM_TEXT from "./fixtures/chat-stream.expected.txt?raw";
import { vramNeededGb, parseHfModel, gpuCards, podInput, burnRatePerHr, sseText, PRESETS, VLLM_IMAGE, type Gpu } from "../src/cost";

// Shape of GET /v2/catalog/gpus items (api.runpod.io/v2/openapi.json); price is null off that cloud.
const gpu = (name: string, memory: number, secure: number | null, community: number | null, availability = "HIGH"): Gpu => ({
  id: `NVIDIA ${name}`,
  name,
  memory,
  secure: secure !== null,
  community: community !== null,
  price: { secure, community },
  availability,
});

describe("vramNeededGb", () => {
  it("bf16 8B", () => {
    const need = vramNeededGb({ BF16: 8e9 });

    expect(need).toBeCloseTo(21.2, 5);
  });

  it("u8 packed weights count 1 byte", () => {
    const need = vramNeededGb({ BF16: 1e9, U8: 10e9 });

    expect(need).toBeCloseTo((2 + 10) * 1.2 + 2, 5);
  });
});

describe("parseHfModel", () => {
  const info = (over: object) => ({
    id: "org/m",
    pipeline_tag: "text-generation",
    gated: false,
    safetensors: { parameters: { BF16: 8e9 } },
    ...over,
  });

  it("not chat", () => {
    const r = parseHfModel(info({ pipeline_tag: "text-to-image" }), true);

    expect(r).toEqual({ ok: false, reason: "not a chat model" });
  });

  it("gated", () => {
    const r = parseHfModel(info({ gated: "manual" }), false);

    expect(r).toEqual({ ok: false, reason: "needs Hugging Face token" });
  });
});

describe("gpuCards", () => {
  it("secure cards", () => {
    const catalog = [
      gpu("RTX 4090", 24, 0.89, 0.59),
      gpu("RTX A4000", 16, 0.25, 0.17),
      gpu("RTX A5000", 24, 0.27, 0.16, "NONE"),
      gpu("A40", 48, 0.59, null),
      gpu("RTX 3070", 8, null, 0.13),
    ];

    const cards = gpuCards(catalog, "SECURE", 21.2);

    expect(cards.map((c) => [c.name, c.price, c.fits, c.reason])).toEqual([
      ["RTX A4000", 0.25, false, "Too small"],
      ["RTX A5000", 0.27, false, "Sold out"],
      ["A40", 0.59, true, ""],
      ["RTX 4090", 0.89, true, ""],
    ]);
  });
});

describe("podInput", () => {
  const model = PRESETS[1];

  it("full", () => {
    const input = podInput(model, "NVIDIA GeForce RTX 4090", "SECURE", "hf_x", "k1", 10, "WD");

    expect(input).toMatchObject({
      name: "hose-qwen3-8b",
      image: VLLM_IMAGE,
      gpu: { id: "NVIDIA GeForce RTX 4090", count: 1, minCudaVersion: "13.0" },
      cloud: "SECURE",
      ports: ["8000/http"],
      // 8.19B BF16 = 16.38 GB weights -> ceil(16.38 * 1.5) + 20
      disk: 45,
      env: { MODEL: "Qwen/Qwen3-8B", HOSE_KEY: "k1", HOSE_IDLE_MIN: "10", HOSE_WATCHDOG: "WD", HF_TOKEN: "hf_x" },
    });
    // no exec: if vLLM dies the container stays up, so the watchdog (not a fresh copy after a restart) deletes the pod
    expect(input.entrypoint.join(" ")).toMatch(/python3 -c "\$HOSE_WATCHDOG" & vllm serve "\$MODEL" .*--api-key "\$HOSE_KEY".*; sleep infinity$/);
  });

  it("no token", () => {
    const input = podInput(model, "NVIDIA GeForce RTX 4090", "SECURE", "", "k1", 10, "WD");

    expect(Object.keys(input.env)).not.toContain("HF_TOKEN");
  });
});

describe("sseText", () => {
  it("joins deltas", () => {
    // captured from a real vLLM pod during the 2026-10-22 spike
    expect(sseText(STREAM)).toBe(STREAM_TEXT);
  });
});

describe("burnRatePerHr", () => {
  it("running only", () => {
    const pods = [
      { status: "RUNNING", cost: 0.89 },
      { status: "EXITED", cost: 0.24 },
    ];

    const rate = burnRatePerHr(pods);

    expect(rate).toBeCloseTo(0.89, 5);
  });
});
