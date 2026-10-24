import { describe, it, expect, vi, beforeEach } from "vitest";
import { effectScope } from "vue";
import { DatabaseSync } from "node:sqlite";
import type { Config } from "../src/cost";
import type { Message } from "../src/api";

// Boundary doubles: the Tauri SQL plugin over a real in-memory SQLite (so the real SQL runs), and the webview's localStorage.
const db = vi.hoisted(() => ({ sql: null as unknown as DatabaseSync }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: async () => null }));
vi.mock("@tauri-apps/plugin-sql", () => ({
  default: {
    load: async () => ({
      execute: async (q: string, args: unknown[] = []) => db.sql.prepare(q).run(...(args as never[])),
      select: async (q: string, args: unknown[] = []) => db.sql.prepare(q).all(...(args as never[])),
    }),
  },
}));
const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
});

// a fresh DB and fresh modules per test: history.ts opens the DB once per module load
let history: typeof import("../src/history");
let useFleet: typeof import("../src/fleet").useFleet;
beforeEach(async () => {
  db.sql = new DatabaseSync(":memory:");
  store.clear();
  vi.resetModules();
  history = await import("../src/history");
  ({ useFleet } = await import("../src/fleet"));
});

const config = (key: string) => ({ key, name: key, id: "Qwen/Qwen3-8B", params: { BF16: 8e9 }, gpuId: "NVIDIA RTX 4090", gpuName: "RTX 4090", cloud: "SECURE", idleMin: 10, pastPodIds: [], spentPast: 0 });
const fleet = () => effectScope().run(() => useFleet(() => "", () => "", () => ""))!;
const rows = (q: string) => db.sql.prepare(q).all();
/** Send one message the way Chat.vue does: push it, then remember it. */
async function say(f: ReturnType<typeof fleet>, c: Config, m: Message) {
  const list = f.chatOf(c);
  list.push(m);
  await f.remember(c, list.length - 1);
}

describe("chat history", () => {
  it("survives restart", async () => {
    store.set("hose.models", JSON.stringify([config("a")]));
    const before = fleet();
    const a = before.s.configs[0];
    await say(before, a, { role: "user", content: "hi", images: ["data:image/jpeg;base64,AAAA"] });
    await say(before, a, { role: "assistant", content: "Hello", thinking: "greet", stats: "9 in · 3 out" });

    const after = fleet(); // a new launch: configs from localStorage, chats from SQLite
    const c = after.s.configs[0];
    await vi.waitFor(() => expect(after.chatsOf(c)).toHaveLength(1));
    const msgs = after.chatOf(c);
    await vi.waitFor(() => expect(msgs).toHaveLength(2));

    expect(after.chatsOf(c)[0]).toMatchObject({ title: "hi", n: 2 });
    expect(c.chat).toBe(after.chatsOf(c)[0].id);
    expect(msgs).toEqual([
      { role: "user", content: "hi", images: ["data:image/jpeg;base64,AAAA"] },
      { role: "assistant", content: "Hello", thinking: "greet", stats: "9 in · 3 out" },
    ]);
  });

  it("new chat keeps old", async () => {
    store.set("hose.models", JSON.stringify([config("a")]));
    const f = fleet();
    const a = f.s.configs[0];
    await say(f, a, { role: "user", content: "hi" });

    f.newChat(a);
    await say(f, a, { role: "user", content: "second" });

    expect(f.chatsOf(a).map((x) => x.title)).toEqual(["second", "hi"]);
    expect(f.chatOf(a).map((m) => m.content)).toEqual(["second"]);
  });

  it("delete chat", async () => {
    store.set("hose.models", JSON.stringify([config("a")]));
    const f = fleet();
    const a = f.s.configs[0];
    await say(f, a, { role: "user", content: "hi" });
    f.newChat(a);
    await say(f, a, { role: "user", content: "second" });
    const second = a.chat!;

    await f.deleteChat(a, second);

    expect(f.chatsOf(a).map((x) => x.title)).toEqual(["hi"]);
    expect(rows(`SELECT * FROM messages WHERE chat = '${second}'`)).toEqual([]);
    expect(a.chat).toBeUndefined();
  });

  it("forget drops chats", async () => {
    store.set("hose.models", JSON.stringify([config("a"), config("b")]));
    const f = fleet();
    const [a, b] = f.s.configs;
    await say(f, a, { role: "user", content: "for a" });
    await say(f, b, { role: "user", content: "for b" });
    const aChat = a.chat!;

    await f.forget(a);

    expect((await history.listChats()).map((x) => x.title)).toEqual(["for b"]);
    expect(rows(`SELECT * FROM messages WHERE chat = '${aChat}'`)).toEqual([]);
  });
});

describe("chatTitle", () => {
  it("takes the first line, 60 chars at most", () => {
    expect(history.chatTitle("  Trip plan for Penang\nwith kids")).toBe("Trip plan for Penang");

    const long = history.chatTitle("a".repeat(70));

    expect(long).toHaveLength(60);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("chatGroups", () => {
  const now = new Date(2026, 9, 23, 12, 0).getTime();
  const at = (...d: [number, number, number, number, number, number?]) => new Date(...d).getTime();
  const chats = [
    { id: "1", config: "a", title: "Penang trip", created: 0, updated: at(2026, 9, 23, 11, 59, 40), n: 4 },
    { id: "2", config: "a", title: "SQL join", created: 0, updated: at(2026, 9, 23, 10, 0), n: 6 },
    { id: "3", config: "a", title: "Lease PDF", created: 0, updated: at(2026, 9, 22, 15, 0), n: 2 },
    { id: "4", config: "a", title: "Landlord email", created: 0, updated: at(2026, 9, 20, 9, 0), n: 3 },
  ];
  const view = (g: ReturnType<typeof history.chatGroups>) => g.map((x) => [x.label, x.chats.map((c) => c.when)]);

  it("buckets", () => {
    const oct20 = new Date(2026, 9, 20).toLocaleDateString([], { month: "short", day: "numeric" }); // "Oct 20" in en-US

    const groups = history.chatGroups(chats, now, "");

    expect(view(groups)).toEqual([
      ["Today", ["now · 4 messages", "2 h ago · 6 messages"]],
      ["Yesterday", ["2 messages"]],
      ["Earlier", [`${oct20} · 3 messages`]],
    ]);
  });

  it("filters by title", () => {
    const groups = history.chatGroups(chats, now, "sql");

    expect(groups.map((g) => [g.label, g.chats.map((c) => c.title)])).toEqual([["Today", ["SQL join"]]]);
  });
});
