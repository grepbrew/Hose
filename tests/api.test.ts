import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { setupServer } from "msw/node";
import { handlers, seed } from "./mocks/handlers";
import { getBalance, getGpus, listHoseEndpoints, endpointCostToday } from "../src/api";

const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterAll(() => server.close());
beforeEach(() => seed("one"));

describe("getBalance", () => {
  it("ok", async () => {
    const balance = await getBalance("good-key");

    expect(balance).toBe(25);
  });

  it("401", async () => {
    await expect(getBalance("bad")).rejects.toThrow("RunPod rejected this key");
  });
});

describe("getGpus", () => {
  it("unwraps gpus", async () => {
    const gpus = await getGpus("good-key");

    expect(gpus).toHaveLength(5);
  });
});

describe("listHoseEndpoints", () => {
  it("filters", async () => {
    const eps = await listHoseEndpoints("good-key");

    expect(eps.map((e) => e.name)).toEqual(["hose-qwen3-8b"]);
  });
});

describe("endpointCostToday", () => {
  it("ok", async () => {
    const cost = await endpointCostToday("good-key", "ep1");

    expect(cost).toBe(0.12);
  });
});
