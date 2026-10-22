import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { effectScope } from "vue";
import { setupServer } from "msw/node";
import { handlers, seed, state } from "./mocks/handlers";

// Boundary double: the webview's localStorage, backed by a Map.
const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
});

const { useFleet } = await import("../src/fleet");

const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterAll(() => server.close());
beforeEach(() => {
  store.clear();
  seed("on"); // pod1 RUNNING in US-TX-3, $0.89/hr, created 21 min ago
});

// Saved before 2026-10-22: no key or name.
const old = (podId: string) => ({ id: "Qwen/Qwen3-8B", params: { BF16: 8190735360 }, gpuId: "NVIDIA RTX 4090", gpuName: "RTX 4090", cloud: "SECURE", idleMin: 10, podId });
const fleet = () => effectScope().run(() => useFleet(() => "good-key", () => "k1", () => ""))!;

describe("refresh", () => {
  it("saves live pod details", async () => {
    store.set("hose.models", JSON.stringify([old("pod1")]));
    const f = fleet();

    await f.refresh();

    const [c] = f.s.configs;
    expect(c.last).toMatchObject({ dataCenter: "US Texas 3", vcpu: 16, memoryGb: 62, diskGb: 45 });
    expect(c.last!.runSpend).toBeCloseTo((21 / 60) * 0.89, 2);
    expect(c.price).toBe(0.89);
  });

  it("banks the run when the pod is gone", async () => {
    store.set("hose.models", JSON.stringify([old("pod1")]));
    const f = fleet();
    await f.refresh();
    const run = f.s.configs[0].last!.runSpend;
    seed("none"); // the watchdog deleted pod1

    await f.refresh();

    const [c] = f.s.configs;
    expect(c.podId).toBeUndefined();
    expect(c.pastPodIds).toEqual(["pod1"]);
    expect(c.spentPast).toBeCloseTo(run, 5);
    expect(c.last).toMatchObject({ dataCenter: "US Texas 3", runSpend: 0 });
  });
});

describe("turnOn", () => {
  it("disk and region", async () => {
    const f = fleet();
    const c = { ...old(""), podId: undefined, key: "k", name: "n", pastPodIds: [], spentPast: 0, cloud: "SECURE" as const, location: "EUROPE", disk: 150 };

    await f.turnOn(c);

    expect(state.lastCreate).toMatchObject({ disk: 150, dataCenterIds: ["EU-RO-1"] });
  });
});
