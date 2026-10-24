// Past chats, kept in SQLite (hose.db in ~/Library/Application Support/com.grepbrew.hose) through tauri-plugin-sql.
// Outside Tauri (vite dev / screen tests) nothing is saved: history lives in the fleet's memory only, as before.
import { isTauri } from "@tauri-apps/api/core";
import Database from "@tauri-apps/plugin-sql";
import type { Message } from "./api";

export type ChatMeta = { id: string; config: string; title: string; created: number; updated: number; n: number };

// body = the Message as JSON (content, thinking, stats, images as data URLs, file), so new fields need no migration.
// ponytail: no size cap; add "delete chats older than" if hose.db grows
const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS chats (id TEXT PRIMARY KEY, config TEXT NOT NULL, title TEXT NOT NULL, created INTEGER NOT NULL, updated INTEGER NOT NULL)",
  "CREATE INDEX IF NOT EXISTS chats_config ON chats (config, updated)",
  "CREATE TABLE IF NOT EXISTS messages (chat TEXT NOT NULL, seq INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY (chat, seq))",
];
let opened: Promise<Database> | undefined;
const db = () =>
  (opened ??= Database.load("sqlite:hose.db").then(async (d) => {
    for (const q of SCHEMA) await d.execute(q);
    return d;
  }));
// writes run one after another, so a reply never lands before its chat row
let queue: Promise<unknown> = Promise.resolve();
const write = (fn: (d: Database) => Promise<unknown>): Promise<void> =>
  isTauri() ? ((queue = queue.catch(() => {}).then(() => db().then(fn))) as Promise<void>) : Promise.resolve();

export const listChats = async (): Promise<ChatMeta[]> =>
  isTauri()
    ? (await db()).select<ChatMeta[]>("SELECT id, config, title, created, updated, (SELECT COUNT(*) FROM messages WHERE chat = chats.id) AS n FROM chats ORDER BY updated DESC")
    : [];

export const loadMessages = async (chat: string): Promise<Message[]> =>
  isTauri() ? (await (await db()).select<{ body: string }[]>("SELECT body FROM messages WHERE chat = ? ORDER BY seq", [chat])).map((r) => JSON.parse(r.body)) : [];

export const addChat = (c: ChatMeta) =>
  write((d) => d.execute("INSERT INTO chats (id, config, title, created, updated) VALUES (?, ?, ?, ?, ?)", [c.id, c.config, c.title, c.created, c.updated]));

/** Saves message seq of a chat (again, when a reply was saved half-way) and marks the chat as just used. */
export const putMessage = (chat: string, seq: number, m: Message, updated = Date.now()) =>
  write(async (d) => {
    await d.execute("INSERT OR REPLACE INTO messages (chat, seq, body) VALUES (?, ?, ?)", [chat, seq, JSON.stringify(m)]);
    await d.execute("UPDATE chats SET updated = ? WHERE id = ?", [updated, chat]);
  });

export const deleteChat = (id: string) =>
  write(async (d) => {
    await d.execute("DELETE FROM messages WHERE chat = ?", [id]);
    await d.execute("DELETE FROM chats WHERE id = ?", [id]);
  });

export const deleteChatsOf = (config: string) =>
  write(async (d) => {
    await d.execute("DELETE FROM messages WHERE chat IN (SELECT id FROM chats WHERE config = ?)", [config]);
    await d.execute("DELETE FROM chats WHERE config = ?", [config]);
  });

/** A chat is named after its first line, cut to 60 characters. */
export function chatTitle(text: string) {
  const line = text.trim().split("\n")[0].trim();
  return line.length > 60 ? `${line.slice(0, 59)}…` : line || "New chat";
}

/** The Chats tab: chats whose title has q, under Today / Yesterday / Earlier, each with its "2 h ago · 6 messages" line. */
export function chatGroups(chats: ChatMeta[], now: number, q: string) {
  const today = new Date(now).setHours(0, 0, 0, 0);
  const yesterday = new Date(today).setDate(new Date(today).getDate() - 1);
  const count = (c: ChatMeta) => `${c.n} message${c.n === 1 ? "" : "s"}`;
  const ago = (t: number) => {
    const min = Math.floor((now - t) / 60000);
    return min < 1 ? "now" : min < 60 ? `${min} min ago` : `${Math.floor(min / 60)} h ago`;
  };
  const groups = [
    { label: "Today", chats: [] as (ChatMeta & { when: string })[] },
    { label: "Yesterday", chats: [] as (ChatMeta & { when: string })[] },
    { label: "Earlier", chats: [] as (ChatMeta & { when: string })[] },
  ];
  const find = q.trim().toLowerCase();
  for (const c of chats) {
    if (!c.title.toLowerCase().includes(find)) continue;
    if (c.updated >= today) groups[0].chats.push({ ...c, when: `${ago(c.updated)} · ${count(c)}` });
    else if (c.updated >= yesterday) groups[1].chats.push({ ...c, when: count(c) });
    else groups[2].chats.push({ ...c, when: `${new Date(c.updated).toLocaleDateString([], { month: "short", day: "numeric" })} · ${count(c)}` });
  }
  return groups.filter((g) => g.chats.length);
}
