import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { setupServer } from "msw/node";
import { handlers, seed } from "./mocks/handlers";
import { getBalance, listHosePods, podReady, chatStream } from "../src/api";

const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterAll(() => server.close());
beforeEach(() => seed("on"));

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
