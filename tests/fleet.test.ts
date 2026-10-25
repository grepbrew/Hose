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
const H = 3.6e6;
const vol = (id: string, name: string) => ({ id, name, size: 40, dataCenter: "US-TX-3", type: "STANDARD" });

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

describe("pollUse", () => {
  // other apps reach the pod through its API: their requests count as activity, as on the pod's watchdog
  it.each([
    ["keeps pod on", 4, []],
    ["idle turns off", 3, ["delete pod1"]],
  ])("%s", async (_, doneLater, expected) => {
    load(old("pod1")); // idle 10 min
    const f = fleet();
    await f.refresh();
    await f.refresh(); // ready on the second check
    state.served = 3;
    await f.pollUse();
    state.served = doneLater;
    f.s.lastActive.pod1 = Date.now() - 20 * 60000;

    await f.pollUse();
    await f.refresh();

    expect(state.calls).toEqual(expected);
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

  it("banks", async () => {
    seed("stored");
    load(stored("", { volumeAt: Date.now() - 730 * H }));
    const f = fleet();
    const c = f.s.configs[0];

    await f.removeStorage(c);

    expect(state.calls).toEqual(["volume delete vol1"]);
    expect(c.storagePast).toBeCloseTo(1.75, 3);
    expect(c.volumeAt).toBeUndefined();
  });

  it("gone", async () => {
    seed("none");
    load(stored("", { volumeId: "vol9" })); // deleted in RunPod's console, or another account's
    const f = fleet();
    const c = f.s.configs[0];

    await f.removeStorage(c);

    expect(c).toMatchObject({ volumeId: undefined, volumeDc: undefined, volumeGb: undefined });
  });
});

describe("volumes", () => {
  it("polled", async () => {
    seed("stored");
    state.volumes.push(vol("vol7", "hose-llama"), vol("vol8", "my-data"));
    load(stored());
    const f = fleet();

    await f.start();

    expect(f.s.volumes.map((v) => v.id)).toEqual(["vol1", "vol7"]);
    expect(f.volumeStrays.value.map((v) => v.id)).toEqual(["vol7"]);
  });

  it("remove stray", async () => {
    seed("stored");
    state.volumes.push(vol("vol7", "hose-llama"), vol("vol8", "my-data"));
    load(stored());
    const f = fleet();
    await f.start();

    await f.removeVolume("vol7");

    expect(state.calls).toEqual(["volume delete vol7"]);
    expect(f.s.volumes.map((v) => v.id)).toEqual(["vol1"]);
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

  it("starts the storage clock", async () => {
    seed("none");
    load(old(""));
    const f = fleet();
    const c = f.s.configs[0];
    const before = Date.now();

    await f.turnOn(c);

    expect(c.volumeAt).toBeGreaterThanOrEqual(before);
    expect(c.volumeAt).toBeLessThanOrEqual(Date.now());
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

  it("resize banks", async () => {
    seed("stored");
    load(stored("", { disk: 50, volumeAt: Date.now() - 365 * H }));
    const f = fleet();
    const c = f.s.configs[0];
    const before = Date.now();

    await f.turnOn(c);

    expect(c.storagePast).toBeCloseTo(0.875, 3); // 25 GB for half a month
    expect(c.volumeAt).toBeGreaterThanOrEqual(before);
    expect(c.volumeGb).toBe(50);
  });
});

describe("key change", () => {
  it("polls the new account at once", async () => {
    let key = "good-key";
    const f = effectScope().run(() => useFleet(() => key, () => "k1", () => ""))!;
    await f.start();
    key = "other-key"; // Settings › Keys saved another account's key

    await f.start();

    expect(f.s.balance).toBe(10);
    expect(f.s.pods).toEqual([]);
  });
});
