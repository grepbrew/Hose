import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { setupServer } from "msw/node";
import { handlers, seed } from "./mocks/handlers";
import { getBalance, listHosePods, podReady, chatStream, hfSearch, getDatacenterName } from "../src/api";

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
    let shown = "";

    const text = await chatStream("pod1", "k1", "Qwen/Qwen3-8B", [{ role: "user", content: "hi" }], (t) => (shown = t));

    expect(text).toBe("Hello from fake GPU");
    expect(shown).toBe("Hello from fake GPU");
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
