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

// the model kept on network volume vol1 in US-TX-3 (seeds stored / storedOn)
const stored = (podId = "", over: object = {}) => ({ ...old(podId), volumeId: "vol1", volumeDc: "US-TX-3", volumeGb: 25, ...over });
const load = (c: object) => store.set("hose.models", JSON.stringify([c]));

describe("turnOff", () => {
  it("keeps storage", async () => {
    seed("storedOn");
    load(stored("pod1"));
    const f = fleet();
    await f.refresh();
    const c = f.s.configs[0];

    await f.turnOff(c);

    expect(state.calls).toEqual(["delete pod1"]);
    expect(c.podId).toBeUndefined();
    expect(c.volumeId).toBe("vol1");
  });
});

describe("backstop", () => {
  it("budget", async () => {
    load({ ...old("pod1"), budget: 0.1 });
    const f = fleet();

    await f.refresh(); // 21 min at $0.89/hr ≈ $0.31, over the $0.10 budget

    expect(state.calls).toEqual(["delete pod1"]);
  });
});

describe("removeStorage", () => {
  it("deletes the volume, keeps the config", async () => {
    seed("stored");
    load(stored());
    const f = fleet();
    const c = f.s.configs[0];

    await f.removeStorage(c);

    expect(state.calls).toEqual(["volume delete vol1"]);
    expect(c).toMatchObject({ volumeId: undefined, volumeDc: undefined, volumeGb: undefined });
    expect(f.groups.value.saved).toContain(c);
  });
});

describe("turnOn", () => {
  it("disk and region", async () => {
    seed("none");
    load({ ...old(""), location: "EUROPE", disk: 150 }); // EU-RO-1 has HIGH_PERFORMANCE volumes only
    const f = fleet();

    await f.turnOn(f.s.configs[0]);

    expect(state.calls).toEqual(["create"]);
    expect(state.lastCreate).toMatchObject({ disk: 170, dataCenterIds: ["EU-RO-1"] });
  });

  it("makes volume", async () => {
    seed("none");
    load(old(""));
    const f = fleet();
    const c = f.s.configs[0];

    await f.turnOn(c);

    expect(state.calls).toEqual(["volume create US-TX-3", "create"]);
    expect(c.volumeDc).toBe("US-TX-3");
    expect(state.lastCreate).toMatchObject({ dataCenterIds: ["US-TX-3"], mounts: { network: [{ volumeId: c.volumeId, path: "/workspace" }] } });
  });

  it("reuses volume", async () => {
    seed("stored");
    load(stored());
    const f = fleet();

    const moved = await f.turnOn(f.s.configs[0]);

    expect(state.calls).toEqual(["create"]);
    expect(state.lastCreate).toMatchObject({ dataCenterIds: ["US-TX-3"], mounts: { network: [{ volumeId: "vol1" }] } });
    expect(moved).toBe(false);
  });

  it("fallback", async () => {
    seed("stored");
    state.full = true; // US-TX-3 has no free RTX 4090 right now
    load(stored());
    const f = fleet();
    const c = f.s.configs[0];

    const moved = await f.turnOn(c);

    expect(state.calls).toEqual(["create full", "create"]);
    expect(Object.keys(state.lastCreate!)).not.toContain("mounts");
    expect(moved).toBe(true);
    expect(c.volumeId).toBe("vol1");
  });

  it("community drops volume", async () => {
    seed("stored");
    load(stored("", { cloud: "COMMUNITY" }));
    const f = fleet();

    await f.turnOn(f.s.configs[0]);

    expect(state.calls).toEqual(["volume delete vol1", "create"]);
    expect(Object.keys(state.lastCreate!)).not.toContain("mounts");
  });

  it("resize", async () => {
    seed("stored");
    load(stored("", { disk: 50 }));
    const f = fleet();

    await f.turnOn(f.s.configs[0]);

    expect(state.calls).toEqual(["volume resize vol1 50", "create"]);
  });
});
