import { describe, it, expect, vi } from "vitest";
import { effectScope, nextTick } from "vue";

// Boundary doubles: Tauri's command bridge (records relay_set) and an event system that can't start, as in a test
// runner or a broken webview. The app must say so, not leave an unhandled rejection behind.
const calls = vi.hoisted(() => [] as { cmd: string; args: unknown }[]);
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: async (cmd: string, args: unknown) => void calls.push({ cmd, args }) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.reject(new Error("no event system")) }));
vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} });

const { useFleet } = await import("../src/fleet");

describe("relay hookup", () => {
  it("no event system", async () => {
    const f = effectScope().run(() => useFleet(() => "", () => "vk", () => "", () => "rk"))!;

    await nextTick();
    await new Promise((r) => setTimeout(r, 0));

    expect(calls[0]).toEqual({ cmd: "relay_set", args: { table: { token: "rk", podKey: "vk", routes: [] } } });
    expect(f.s.relayError).toBe("Error: no event system");
  });
});
