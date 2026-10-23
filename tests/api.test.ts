import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { setupServer } from "msw/node";
import { handlers, seed, state } from "./mocks/handlers";
import { getBalance, listHosePods, podReady, chatStream, drawImage, podLogs, hfSearch, hfModelInfo, getDatacenterName, type LogLine, type Message, type Reply } from "../src/api";

const server = setupServer(...handlers);
let calls: string[] = [];
let urls: string[] = [];
server.events.on("request:start", ({ request }) => void (calls.push(new URL(request.url).pathname), urls.push(request.url)));
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterAll(() => server.close());
beforeEach(() => {
  seed("on");
  calls = [];
  urls = [];
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
    ["broken", "The model answered with error 500: Internal Server Error"],
  ])("%s rejects", async (id, msg) => {
    await expect(chatStream(id, "k1", "Qwen/Qwen3-8B", [{ role: "user", content: "hi" }], false, () => {})).rejects.toThrow(msg);
  });

  it("images", async () => {
    const url = "data:image/jpeg;base64,AA";

    const reply = await chatStream("pod1", "k1", "Qwen/Qwen3.5-9B", [{ role: "user", content: "read", images: [url] }], false, () => {});

    expect(state.lastChat!.messages[0].content).toEqual([{ type: "text", text: "read" }, { type: "image_url", image_url: { url } }]);
    expect("max_tokens" in state.lastChat!).toBe(false); // a page read out runs past 1024 tokens
    expect(reply.content).toBe("I see 1 image.");
  });
});

describe("drawImage", () => {
  it("ok", async () => {
    const url = await drawImage("pod1", "vk", "Tongyi-MAI/Z-Image-Turbo", "a red fox", "1024x1024", 9);

    expect(url).toMatch(/^data:image\/png;base64,iVBORw0KGgo/);
    expect(state.lastDraw).toEqual({
      model: "Tongyi-MAI/Z-Image-Turbo",
      prompt: "a red fox",
      size: "1024x1024",
      n: 1,
      response_format: "b64_json",
      num_inference_steps: 9,
    });
    expect(state.drawAuth).toBe("Bearer vk");
  });

  it("error", async () => {
    // vLLM-Omni's 400 for a bad size (spike 2026-10-23): {"error": {"message": …}}
    await expect(drawImage("broken", "vk", "Tongyi-MAI/Z-Image-Turbo", "x", "banana")).rejects.toThrow("size must be in format 'WIDTHxHEIGHT'");
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

    // DeepSeek-OCR is image-text-to-text but has no chat template, so vLLM can't chat with it
    expect(found).toEqual([{ id: "deepseek-ai/DeepSeek-R1-Distill-Qwen-7B", params: { BF16: 7615616512 }, downloads: 1316000, gated: false, thinks: true }]);
  });

  it("author sort", async () => {
    const found = await hfSearch("", "", { author: "Qwen", sort: "trendingScore" });

    const q = new URL(urls.find((u) => u.includes("/api/models?"))!).searchParams;
    expect([q.get("author"), q.get("sort")]).toEqual(["Qwen", "trendingScore"]);
    // the embedding model isn't a chat model
    expect(found).toEqual([{ id: "Qwen/Qwen3-8B", params: { BF16: 8190735360 }, downloads: 9100000, gated: false, thinks: true }]);
  });

  it("draws", async () => {
    const flux = await hfSearch("flux", "", { draws: true });
    const sd = await hfSearch("diffusion", "", { draws: true });

    const q = new URL(urls.find((u) => u.includes("/api/models?"))!).searchParams;
    expect([q.get("pipeline_tag"), q.get("library")]).toEqual(["text-to-image", "diffusers"]);
    // the GGUF has no diffusers class, SD 1.5's pipeline isn't one vLLM-Omni runs
    expect(flux).toEqual([{ id: "black-forest-labs/FLUX.1-schnell", params: { BF16: 11891178560 }, draws: true, downloads: 535807, gated: "auto", thinks: false }]);
    expect(sd).toEqual([]);
  });
});

describe("hfModelInfo", () => {
  it("ok", async () => {
    const info = await hfModelInfo("Qwen/Qwen3-8B", "");

    expect(info).toMatchObject({
      id: "Qwen/Qwen3-8B",
      pipeline_tag: "text-generation",
      safetensors: { parameters: { BF16: 8e9 } },
      config: { tokenizer_config: { chat_template: expect.any(String) } },
    });
  });

  it("missing", async () => {
    await expect(hfModelInfo("org/missing", "")).rejects.toThrow("No model with that name on Hugging Face");
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
