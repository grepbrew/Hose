import { describe, it, expect } from "vitest";
import { vramNeededGb, pickPools, parseHfModel, burnRatePerHr, gpuState, endpointInput, streamText, PRESETS, type Gpu } from "../src/cost";

const gpu = (pool: string, memory: number, serverless: number, availability = "HIGH"): Gpu => ({
  id: `gpu-${pool}`,
  pool,
  memory,
  price: { serverless },
  availability,
});

const catalog = [gpu("AMPERE_16", 16, 0.58), gpu("AMPERE_24", 24, 0.69), gpu("AMPERE_48", 48, 1.22), gpu("AMPERE_80", 80, 2.72)];

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

describe("PRESETS", () => {
  it.each([
    ["Fast", "AMPERE_16"],
    ["Balanced", "AMPERE_24"],
    ["Smarter", "AMPERE_48"],
  ])("%s fits %s", (label, pool) => {
    const preset = PRESETS.find((p) => p.label === label)!;

    const pick = pickPools(catalog, vramNeededGb(preset.params));

    expect(pick.pools[0]).toBe(pool);
  });
});

describe("pickPools", () => {
  it("picks smallest fit + next", () => {
    const pick = pickPools(catalog, 21.2);

    expect(pick.pools).toEqual(["AMPERE_24", "AMPERE_48"]);
  });

  it("skips NONE", () => {
    const pick = pickPools([...catalog.filter((g) => g.pool !== "AMPERE_24"), gpu("AMPERE_24", 24, 0.69, "NONE")], 21.2);

    expect(pick.pools[0]).toBe("AMPERE_48");
  });

  it("too big", () => {
    expect(() => pickPools(catalog, 150)).toThrow(/too big/);
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

describe("burnRatePerHr", () => {
  it("sums billed", () => {
    const workers = [
      { id: "w1", gpuTypeId: "NVIDIA GeForce RTX 4090", gpuCount: 1, status: "RUNNING" },
      { id: "w2", gpuTypeId: "NVIDIA RTX A5000", gpuCount: 1, status: "IDLE" },
      { id: "w3", gpuTypeId: "NVIDIA RTX A5000", gpuCount: 1, status: "THROTTLED" },
    ];
    const prices = { "NVIDIA GeForce RTX 4090": 1.1, "NVIDIA RTX A5000": 0.69 };

    const rate = burnRatePerHr(workers, prices);

    expect(rate).toBeCloseTo(1.79, 5);
  });
});

describe("gpuState", () => {
  const w = (status: string) => ({ id: status, gpuTypeId: "g", gpuCount: 1, status });

  it.each([
    [[], "Asleep"],
    [[w("THROTTLED")], "Asleep"],
    [[w("INITIALIZING")], "Waking up"],
    [[w("IDLE")], "Ready"],
    [[w("IDLE"), w("RUNNING")], "Answering"],
  ])("%j -> %s", (workers, state) => {
    expect(gpuState(workers)).toBe(state);
  });
});

describe("endpointInput", () => {
  const model = PRESETS[1];

  it("guardrail", () => {
    const input = endpointInput(model, ["AMPERE_24", "AMPERE_48"], "hf_x");

    expect(input).toMatchObject({
      workersMin: 0,
      workersMax: 1,
      idleTimeout: 60,
      gpuIds: "AMPERE_24,AMPERE_48",
      minCudaVersion: "13.0",
      modelReferences: ["https://huggingface.co/Qwen/Qwen3-8B:main"],
      flashBootType: "FLASHBOOT",
    });
    // 8.19B BF16 = 16.38 GB weights -> ceil(16.38 * 1.5) + 20
    expect(input.template.containerDiskInGb).toBe(45);
    expect(input.name).toMatch(/^hose-qwen3-8b/);
    expect(input.template.env).toContainEqual({ key: "MODEL_NAME", value: "Qwen/Qwen3-8B" });
    expect(input.template.env).toContainEqual({ key: "HF_TOKEN", value: "hf_x" });
  });

  it("no token", () => {
    const input = endpointInput(model, ["AMPERE_24"], "");

    expect(input.template.env.map((e) => e.key)).not.toContain("HF_TOKEN");
  });
});

describe("streamText", () => {
  it("joins", () => {
    // ponytail: provisional vLLM worker chunk shape; replace with spike capture
    const chunks = [{ output: { choices: [{ tokens: ["Hel", "lo"] }] } }, { output: { choices: [{ tokens: [" there"] }] } }];

    expect(streamText(chunks)).toBe("Hello there");
  });
});
