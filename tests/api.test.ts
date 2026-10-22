import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { setupServer } from "msw/node";
import { handlers, seed, state } from "./mocks/handlers";
import { getBalance, listHosePods, podReady, chatStream, podLogs, hfSearch, getDatacenterName, type LogLine, type Message, type Reply } from "../src/api";

const server = setupServer(...handlers);
let calls: string[] = [];
server.events.on("request:start", ({ request }) => void calls.push(new URL(request.url).pathname));
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterAll(() => server.close());
beforeEach(() => {
  seed("on");
  calls = [];
});

describe("getBalance", () => {
  it("ok", async () => {
    const balance = await getBalance("good-key");

    expect(balance).toBe(25);
  });

  it("401", async () => {
    await expect(getBalance("bad")).rejects.toThrow("RunPod rejected this key");
  });
});

describe("listHosePods", () => {
  it("filters", async () => {
    const pods = await listHosePods("good-key");

    expect(pods.map((p) => p.name)).toEqual(["hose-qwen3-8b"]);
  });
});

describe("podReady", () => {
  it.each([
    ["pod1", true],
    ["booting", false],
  ])("%s -> %s", async (id, ready) => {
    expect(await podReady(id, "k1")).toBe(ready);
  });
});

describe("chatStream", () => {
  it("collects", async () => {
    let shown: Reply | null = null;

    const reply = await chatStream("pod1", "k1", "Qwen/Qwen3-8B", [{ role: "user", content: "hi" }], false, (r) => (shown = r));

    expect(reply).toMatchObject({ content: "Hello from fake GPU", thinking: "" });
    expect(reply.stats).toMatch(/^9 in · 3 out · /);
    expect(shown).toEqual(reply);
  });

  it.each([
    ["think", true, { chat_template_kwargs: { enable_thinking: true }, stream_options: { include_usage: true } }],
    ["no think", false, { chat_template_kwargs: { enable_thinking: false }, max_tokens: 1024 }],
  ])("body %s", async (_, think, expected) => {
    const history: Message[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "x", thinking: "t", stats: "s" },
    ];

    await chatStream("pod1", "k1", "Qwen/Qwen3-8B", history, think, () => {});

    expect(state.lastChat).toMatchObject({ ...expected, messages: [{ role: "user", content: "hi" }, { role: "assistant", content: "x" }] });
    expect(state.lastChat!.messages[1]).toEqual({ role: "assistant", content: "x" });
    expect("max_tokens" in state.lastChat!).toBe(!think);
  });

  it.each([
    ["mute", "The model sent back an empty reply"],
    ["broken", "The model answered with error 500"],
  ])("%s rejects", async (id, msg) => {
    await expect(chatStream(id, "k1", "Qwen/Qwen3-8B", [{ role: "user", content: "hi" }], false, () => {})).rejects.toThrow(msg);
  });
});

describe("podLogs", () => {
  it("streams cleaned lines", async () => {
    const lines: LogLine[] = [];

    await podLogs("good-key", "pod1", "", (l) => lines.push(l), new AbortController().signal);

    expect(lines).toEqual([
      { ts: "2026-10-22T10:00:01Z", source: "system", line: "Pulling image vllm/vllm-openai:v0.32.0" },
      { ts: "2026-10-22T10:00:40Z", source: "container", line: "INFO Starting vLLM API server" },
      { ts: "2026-10-22T10:00:52Z", source: "container", line: "Downloading 100%" },
      { ts: "2026-10-22T10:01:30Z", source: "container", line: "Loading weights took 12.3 seconds" },
    ]);
  });

  it("bad key", async () => {
    await expect(podLogs("bad", "pod1", "", () => {}, new AbortController().signal)).rejects.toThrow("RunPod rejected this key");
  });
});

describe("hfSearch", () => {
  it("chat models only", async () => {
    const found = await hfSearch("deepseek", "");

    expect(found).toEqual([
      { id: "deepseek-ai/DeepSeek-OCR", params: { BF16: 3336106240 }, downloads: 2092524, gated: false },
      { id: "deepseek-ai/DeepSeek-R1-Distill-Qwen-7B", params: { BF16: 7615616512 }, downloads: 1316000, gated: false },
    ]);
  });
});

describe("getDatacenterName", () => {
  it("cached", async () => {
    const first = await getDatacenterName("good-key", "US-TX-3");
    const again = await getDatacenterName("good-key", "US-TX-3");
    const unknown = await getDatacenterName("good-key", "XX-1");

    expect([first, again, unknown]).toEqual(["US Texas 3", "US Texas 3", "XX-1"]);
    expect(calls.filter((c) => c.endsWith("/catalog/datacenters"))).toHaveLength(1);
  });
});
