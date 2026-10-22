import { describe, it, expect } from "vitest";
import STREAM from "./fixtures/chat-stream.txt?raw";
import STREAM_TEXT from "./fixtures/chat-stream.expected.txt?raw";
import THINK_STREAM from "./fixtures/chat-stream-think.txt?raw";
import METRICS from "./fixtures/vllm-metrics.txt?raw";
import {
  vramNeededGb,
  parseHfModel,
  gpuCards,
  podInput,
  diskGb,
  fitDisk,
  dcIds,
  placeName,
  burnRatePerHr,
  sseReply,
  splitThink,
  replyStats,
  vllmLoad,
  logText,
  migrateConfigs,
  upsertConfig,
  spendTotals,
  snapshotOf,
  endRun,
  sidebarGroups,
  initialSelection,
  budgetMin,
  volumeDc,
  stuckBoot,
  offText,
  allDay,
  PRESETS,
  VLLM_IMAGE,
  type Config,
  type DataCenter,
  type Gpu,
  type Sel,
} from "../src/cost";

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

  it("image-text-to-text", () => {
    // Qwen3.5/3.8 and Gemma 4 are tagged image-text-to-text; Hose uses them for text chat
    const r = parseHfModel(info({ pipeline_tag: "image-text-to-text", safetensors: { parameters: { BF16: 9e9 } } }), true);

    expect(r).toEqual({ ok: true, model: { id: "org/m", params: { BF16: 9e9 } } });
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

  it("by location", () => {
    const at = (g: Gpu, dataCenters: [string, string][]) => ({ ...g, dataCenters: dataCenters.map(([id, availability]) => ({ id, availability })) });
    const catalog = [
      at(gpu("RTX 4090", 24, 0.89, 0.59), [["US-TX-3", "HIGH"], ["EU-RO-1", "LOW"]]),
      at(gpu("A40", 48, 0.59, null), [["EU-RO-1", "MEDIUM"]]),
      at(gpu("RTX A4000", 16, 0.25, 0.17), [["US-TX-3", "HIGH"]]),
    ];

    expect(gpuCards(catalog, "SECURE", 21.2, ["EU-RO-1"]).map((c) => [c.name, c.stock])).toEqual([
      ["A40", "MEDIUM"],
      ["RTX 4090", "LOW"],
    ]);
    // a region: the best stock among its data centers
    expect(gpuCards(catalog, "SECURE", 21.2, ["US-TX-3", "EU-RO-1"]).find((c) => c.name === "RTX 4090")!.stock).toBe("HIGH");
  });
});

// Shape of GET /v2/catalog/datacenters items (api.runpod.io/v2/openapi.json)
const DCS: DataCenter[] = [
  { id: "US-TX-3", name: "US Texas 3", region: "NORTH_AMERICA" },
  { id: "EU-RO-1", name: "EU Romania 1", region: "EUROPE" },
  { id: "EU-CZ-1", name: "EU Czech 1", region: "EUROPE" },
  { id: "EUR-IS-2", name: "EUR-IS-2", region: "EUROPE" }, // live: name is just the id
  { id: "CA-MTL-1", name: "CA-MTL-1", region: "NORTH_AMERICA" },
];

describe("dcIds", () => {
  it.each([
    ["", []],
    ["EUROPE", ["EU-RO-1", "EU-CZ-1", "EUR-IS-2"]],
    ["US-TX-3", ["US-TX-3"]],
  ])("%s", (location, ids) => expect(dcIds(location, DCS)).toEqual(ids));
});

describe("placeName", () => {
  it.each([
    ["EUROPE", "Europe"],
    ["NORTH_AMERICA", "North America"],
    ["EU-RO-1", "EU Romania 1"],
    ["EUR-IS-2", "Iceland (EUR-IS-2)"],
    ["CA-MTL-1", "Canada (CA-MTL-1)"],
    ["US-KS-2", "United States (US-KS-2)"],
    ["XX-1", "XX-1"],
  ])("%s", (location, name) => expect(placeName(location, DCS)).toBe(name));
});

describe("fitDisk", () => {
  const q8 = { BF16: 8190735360 }; // 16.4 GB of files

  it("recommendation rounds up to 5 GB", () => {
    expect(diskGb({ BF16: 9653100528, F32: 3840 })).toBe(30); // 19.3 × 1.1 + 5 = 26.2 → 30
    expect(diskGb(q8)).toBe(25);
  });

  it.each([
    [52, 55],
    [20, 25],
    [120, 120],
    [NaN, 25],
  ])("%s", (gb, want) => expect(fitDisk(gb, q8)).toBe(want));
});

describe("podInput", () => {
  // was PRESETS[1]; the curated list changed (2026-10-22 redesign), the spec under test did not
  const model = { id: "Qwen/Qwen3-8B", params: { BF16: 8190735360 } };

  it("full", () => {
    const input = podInput(model, "NVIDIA GeForce RTX 4090", "SECURE", "hf_x", "k1", 10, "WD");

    expect(input).toMatchObject({
      name: "hose-qwen3-8b",
      image: VLLM_IMAGE,
      gpu: { id: "NVIDIA GeForce RTX 4090", count: 1, minCudaVersion: "13.0" },
      cloud: "SECURE",
      ports: ["8000/http"],
      // no volume: the container disk holds the model (16.38 GB × 1.1 + 5 = 23 → 25) plus 20 GB scratch
      disk: 45,
      env: {
        MODEL: "Qwen/Qwen3-8B",
        HOSE_KEY: "k1",
        HOSE_IDLE_MIN: "10",
        HOSE_MAX_MIN: "0",
        HOSE_WATCHDOG: "WD",
        HF_HOME: "/workspace/hf",
        VLLM_CACHE_ROOT: "/workspace/vllm",
        HF_TOKEN: "hf_x",
      },
    });
    // no exec: if vLLM dies the container stays up, so the watchdog (not a fresh copy after a restart) deletes the pod
    expect(input.entrypoint.join(" ")).toMatch(/python3 -c "\$HOSE_WATCHDOG" & vllm serve "\$MODEL" .*--api-key "\$HOSE_KEY".*; sleep infinity$/);
  });

  it("no token", () => {
    const input = podInput(model, "NVIDIA GeForce RTX 4090", "SECURE", "", "k1", 10, "WD");

    expect(Object.keys(input.env)).not.toContain("HF_TOKEN");
  });

  it("disk and location", () => {
    const input = podInput(model, "NVIDIA GeForce RTX 4090", "SECURE", "", "k1", 10, "WD", 150, ["EU-RO-1"]);
    expect(input).toMatchObject({ disk: 170, dataCenterIds: ["EU-RO-1"] });
    expect(Object.keys(input)).not.toContain("mounts");

    const plain = podInput(model, "NVIDIA GeForce RTX 4090", "SECURE", "", "k1", 10, "WD");
    expect(plain.disk).toBe(diskGb(model.params) + 20);
    expect(Object.keys(plain)).not.toContain("dataCenterIds");

    const stored = podInput(model, "NVIDIA GeForce RTX 4090", "SECURE", "", "k1", 10, "WD", 25, ["US-TX-3"], 0, "vol1");
    expect(stored).toMatchObject({ disk: 20, mounts: { network: [{ volumeId: "vol1", path: "/workspace" }] }, dataCenterIds: ["US-TX-3"] });
  });

  it("budget", () => {
    const input = podInput(model, "NVIDIA GeForce RTX 4090", "SECURE", "", "k1", 10, "WD", undefined, [], budgetMin(5, 0.89));

    expect(input.env.HOSE_MAX_MIN).toBe("337"); // $5 at $0.89/hr = 337 min
  });
});

describe("sseReply", () => {
  it("joins deltas", () => {
    // captured from a real vLLM pod during the 2026-10-22 spike
    expect(sseReply(STREAM).content).toBe(STREAM_TEXT);
  });

  it("thinking + usage", () => {
    // Qwen3.5-4B with enable_thinking, real pod 2026-10-22: the template opens <think> in the prompt, only </think> streams
    const reply = sseReply(THINK_STREAM);

    expect(reply.content).toBe("17 times 3 equals 51.");
    expect(reply.thinking).toMatch(/^Thinking Process:/);
    expect(reply.usage).toEqual({ prompt_tokens: 22, total_tokens: 254, completion_tokens: 232 });
  });

  it("thinking while streaming", () => {
    const partial = THINK_STREAM.slice(0, THINK_STREAM.indexOf("</think>")).replace(/\n[^\n]*$/, "\n");

    expect(sseReply(partial, true)).toMatchObject({ content: "", thinking: expect.stringMatching(/^Thinking Process:/) });
  });

  it.each([false, true])("reasoning field, open %s", (open) => {
    const raw = [
      { choices: [{ delta: { reasoning_content: "Add " } }] },
      { choices: [{ delta: { reasoning: "them." } }] },
      { choices: [{ delta: { content: "4" } }] },
      { choices: [], usage: { prompt_tokens: 9, completion_tokens: 3 } },
    ]
      .map((d) => `data: ${JSON.stringify(d)}\n\n`)
      .join("");

    expect(sseReply(raw, open)).toEqual({ content: "4", thinking: "Add them.", usage: { prompt_tokens: 9, completion_tokens: 3 } });
  });
});

describe("splitThink", () => {
  it.each([
    ["closed", "<think>a</think>\n\nb", false, { thinking: "a", content: "b" }],
    ["still thinking", "<think>a", false, { thinking: "a", content: "" }],
    ["template opened it", "a</think>b", false, { thinking: "a", content: "b" }],
    ["template opened it, still thinking", "a", true, { thinking: "a", content: "" }],
    ["no thinking", "plain", false, { thinking: "", content: "plain" }],
  ])("%s", (_, text, open, expected) => {
    expect(splitThink(text, open)).toEqual(expected);
  });
});

describe("vllmLoad", () => {
  it("reads running, waiting and finished", () => {
    // real /metrics lines after 2 chats; the *_by_reason gauges must not count twice
    expect(vllmLoad(METRICS)).toEqual({ busy: 0, done: 2 });
  });
});

describe("replyStats", () => {
  it.each([
    ["with speed", 2400, "12 in · 96 out · 40 tok/s · 0.4 s to first token"],
    ["no generation time", 0, "12 in · 96 out · 0.4 s to first token"],
  ])("%s", (_, genMs, expected) => {
    expect(replyStats({ prompt_tokens: 12, completion_tokens: 96 }, 400, genMs)).toBe(expected);
  });
});

describe("logText", () => {
  it.each([
    ["strips ANSI colour", "\x1b[32mINFO\x1b[0m Starting", "INFO Starting"],
    ["keeps the last progress update", "Downloading 10%\rDownloading 100%", "Downloading 100%"],
    ["blank stays blank", " \r", ""],
  ])("%s", (_, line, expected) => {
    expect(logText(line)).toBe(expected);
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

describe("PRESETS", () => {
  it("curated list", () => {
    expect(PRESETS.map((p) => [p.size, p.id.split("/").pop()])).toEqual([
      ["S", "Qwen3.5-4B"],
      ["S", "Qwen3-4B-Instruct-2507"],
      ["S", "Phi-4-mini-instruct"],
      ["M", "Qwen3.5-9B"],
      ["M", "Llama-3.1-8B-Instruct"],
      ["M", "granite-4.2-8b"],
      ["L", "Qwen3.8-27B"],
      ["L", "gemma-4-26B-A4B-it"],
      ["L", "gpt-oss-20b"],
    ]);
  });
});

const config = (over: Partial<Config> = {}): Config => ({
  key: "a",
  name: "Qwen3-8B · RTX 4090",
  id: "Qwen/Qwen3-8B",
  params: { BF16: 8190735360 },
  gpuId: "NVIDIA RTX 4090",
  gpuName: "RTX 4090",
  cloud: "SECURE",
  idleMin: 10,
  pastPodIds: [],
  spentPast: 0,
  ...over,
});

describe("migrateConfigs", () => {
  it("adds key and name", () => {
    const old = { id: "Qwen/Qwen3-8B", params: { BF16: 8190735360 }, gpuId: "NVIDIA RTX 4090", gpuName: "RTX 4090", cloud: "SECURE", idleMin: 10, podId: "p1" };
    const current = config({ key: "b", name: "Mine" });

    const [migrated, kept] = migrateConfigs([old, current]);

    expect(migrated).toMatchObject({ ...old, name: "Qwen3-8B · RTX 4090", pastPodIds: [], spentPast: 0 });
    expect(migrated.key).toMatch(/^[0-9a-f-]{36}$/);
    expect(kept).toEqual(current);
  });
});

describe("upsertConfig", () => {
  it("many configs per model", () => {
    const a = config();
    const b = config({ key: "b", name: "Qwen3-8B · A40", gpuId: "NVIDIA A40", gpuName: "A40" });

    const two = upsertConfig([a], b);
    const renamed = upsertConfig(two, { ...a, name: "Work" });

    expect(two.map((c) => c.key)).toEqual(["a", "b"]);
    expect(renamed.map((c) => c.name)).toEqual(["Work", "Qwen3-8B · A40"]);
  });
});

const last = { dataCenter: "US Texas 3", vcpu: 16, memoryGb: 62, diskGb: 45, image: VLLM_IMAGE, startedAt: "2026-10-22T10:00:00Z" };

describe("spendTotals", () => {
  it("run and all time", () => {
    const on = config({ podId: "p1", spentPast: 2, last: { ...last, runSpend: 1.5 } });

    expect(spendTotals(on)).toEqual({ run: 1.5, allTime: 3.5 });
    expect(spendTotals({ ...on, podId: undefined, last: { ...last, runSpend: 0 } })).toEqual({ run: 0, allTime: 2 });
  });
});

describe("snapshotOf", () => {
  it("live pod fields", () => {
    const now = Date.parse("2026-10-22T12:00:00Z");
    const pod = {
      id: "p1",
      name: "hose-qwen3-8b",
      status: "RUNNING",
      cost: 0.75,
      createdAt: "2026-10-22T10:00:00Z",
      startedAt: "2026-10-22T10:00:00Z",
      dataCenterId: "US-TX-3",
      image: VLLM_IMAGE,
      disk: 45,
      gpu: { id: "NVIDIA RTX 4090", count: 1, vcpuCount: 16, memory: 62 },
    };

    const snap = snapshotOf(pod, "US Texas 3", now);

    // billed from creation (image pull included): 2 h x $0.75
    expect(snap).toEqual({ ...last, runSpend: 1.5 });
  });
});

describe("endRun", () => {
  it("folds run spend", () => {
    const c = config({ podId: "p1", spentPast: 2, last: { ...last, runSpend: 1.5 } });

    endRun(c);

    expect(c).toMatchObject({ spentPast: 3.5, pastPodIds: ["p1"], last: { ...last, runSpend: 0 } });
    expect(c.podId).toBeUndefined();
  });
});

describe("volumeDc", () => {
  const dcs: DataCenter[] = [
    { id: "US-TX-3", name: "US-TX-3", region: "NORTH_AMERICA", networkVolumeTypes: ["STANDARD"] },
    { id: "EU-RO-1", name: "EU-RO-1", region: "EUROPE", networkVolumeTypes: ["HIGH_PERFORMANCE"] },
    { id: "CA-MTL-3", name: "CA-MTL-3", region: "NORTH_AMERICA", networkVolumeTypes: ["STANDARD"] },
  ];
  const rtx = {
    ...gpu("RTX 4090", 24, 0.89, 0.59),
    dataCenters: [
      { id: "EU-RO-1", availability: "HIGH" },
      { id: "CA-MTL-3", availability: "LOW" },
      { id: "US-TX-3", availability: "MEDIUM" },
    ],
  };

  it.each<[string, Gpu, string[], string]>([
    ["anywhere", rtx, [], "US-TX-3"],
    ["EUROPE ids", rtx, ["EU-RO-1"], ""],
    ["GPU without dataCenters", gpu("RTX 4090", 24, 0.89, 0.59), [], ""],
  ])("%s", (_, g, ids, want) => expect(volumeDc(g, ids, dcs)).toBe(want));
});

describe("stuckBoot", () => {
  const now = Date.parse("2026-10-22T12:00:00Z");
  const ago = (min: number) => new Date(now - min * 60000).toISOString();

  it.each<[string, string | undefined, number, boolean]>([
    ["4 min, no lines", ago(4), 0, true],
    ["2 min, no lines", ago(2), 0, false],
    ["4 min, 5 lines", ago(4), 5, false],
    ["no createdAt", undefined, 0, false],
  ])("%s", (_, createdAt, lines, want) => expect(stuckBoot(createdAt, now, lines)).toBe(want));
});

describe("offText", () => {
  it.each<[string, Partial<Config>, string]>([
    ["idle 10", { idleMin: 10 }, "after 10 quiet min"],
    ["idle 0 + $5", { idleMin: 0, budget: 5 }, "at $5 a run"],
    ["idle 10 + $5", { idleMin: 10, budget: 5 }, "after 10 quiet min or $5 a run"],
    ["idle 0 no budget", { idleMin: 0 }, "never: on 24/7"],
  ])("%s", (_, over, want) => expect(offText(config(over))).toBe(want));
});

describe("allDay", () => {
  it("24/7 cost", () => {
    const cost = allDay(0.44);

    expect(cost.day).toBeCloseTo(10.56);
    expect(cost.month).toBeCloseTo(321.2); // 730 h a month
  });
});

describe("sidebarGroups", () => {
  it("running saved strays", () => {
    const a = config({ podId: "pA" });
    const b = config({ key: "b" });
    const pods = [{ id: "pA" }, { id: "pS" }];

    const g = sidebarGroups([a, b], pods);

    expect(g).toEqual({ running: [a], saved: [b], strays: [{ id: "pS" }] });
  });
});

describe("initialSelection", () => {
  const a = config({ podId: "pA" });
  const b = config({ key: "b" });
  const pods = [{ id: "pA" }, { id: "pS" }];
  it.each<[string, Sel | null, Config[], Sel]>([
    ["stored config", { kind: "config", key: "b" }, [a, b], { kind: "config", key: "b" }],
    ["stored stray", { kind: "stray", podId: "pS" }, [a, b], { kind: "stray", podId: "pS" }],
    ["stored keys", { kind: "keys" }, [a, b], { kind: "keys" }],
    ["stored gone -> first running", { kind: "config", key: "zzz" }, [b, a], { kind: "config", key: "a" }],
    ["nothing running -> new", null, [b], { kind: "new" }],
  ])("%s", (_, stored, configs, want) => {
    expect(initialSelection(stored, configs, pods)).toEqual(want);
  });
});
