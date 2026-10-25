// The user's pod configs (remembered on this Mac) and their Pods on RunPod, polled while the app is open.
// Shared by the Sidebar, New pod and pod pages.
import { reactive, computed, watch, onUnmounted } from "vue";
import { listHosePods, createPod, deletePod, createVolume, deleteVolume, resizeVolume, listHoseVolumes, podReady, podLoad, getBalance, getGpus, getDatacenterName, getDataCenters, type Message, type Pod, type Volume } from "./api";
import { burnRatePerHr, podInput, dcIds, diskGb, volumeDc, hoseName, migrateConfigs, upsertConfig, snapshotOf, endRun, sidebarGroups, strayVolumes, bankStorage, budgetMin, type Config } from "./cost";
import { listChats, loadMessages, addChat, putMessage, deleteChat as dropChat, deleteChatsOf, chatTitle, type ChatMeta } from "./history";
import WATCHDOG from "./watchdog.py?raw";

export type { Config };
export type ModelState = "Off" | "Starting" | "On" | "Answering";

const STORE = "hose.models";
const load = (): Config[] => {
  try {
    return migrateConfigs(JSON.parse(localStorage.getItem(STORE) ?? "[]"));
  } catch {
    return [];
  }
};

export function useFleet(key: () => string, vllmKey: () => string, hfToken: () => string) {
  const s = reactive({
    configs: load(),
    pods: [] as Pod[],
    volumes: [] as Volume[], // the account's hose-* network volumes
    ready: {} as Record<string, boolean>,
    lastActive: {} as Record<string, number>, // podId -> last chat activity (or ready time), ms
    answering: "",
    now: Date.now(),
    balance: null as number | null,
    session: 0,
    error: "",
    chats: [] as ChatMeta[], // every saved chat, newest first; messages load when one is opened
  });
  // ponytail: configs in the webview's localStorage; nothing secret in them
  watch(() => s.configs, (v) => localStorage.setItem(STORE, JSON.stringify(v)), { deep: true });

  // Chat history: saved in SQLite (history.ts), messages kept here once loaded.
  // A chat not sent yet lives under new:<config key> and gets its id and row on its first message.
  const failed = (e: unknown) => (s.error = `Couldn't save the chat: ${e instanceof Error ? e.message : String(e)}`);
  listChats().then((l) => s.chats.push(...l), failed);
  const msgs = reactive(new Map<string, Message[]>());
  const slot = (c: Config) => c.chat ?? `new:${c.key}`;
  function chatOf(c: Config) {
    const k = slot(c);
    if (!msgs.has(k)) {
      msgs.set(k, []);
      if (c.chat) loadMessages(c.chat).then((m) => msgs.get(k)?.push(...m), failed);
    }
    return msgs.get(k)!;
  }
  const chatsOf = (c: Config) => s.chats.filter((x) => x.config === c.key);
  const newChat = (c: Config) => void (c.chat = undefined);
  const openChat = (c: Config, id: string) => void (c.chat = id);
  /** Saves message i of the config's open chat; the first one creates the chat, titled after it. */
  async function remember(c: Config, i: number) {
    const list = chatOf(c);
    let meta = s.chats.find((x) => x.id === c.chat);
    if (!meta) {
      const now = Date.now();
      meta = { id: crypto.randomUUID(), config: c.key, title: chatTitle(list[0]?.content ?? ""), created: now, updated: now, n: 0 };
      msgs.delete(slot(c));
      msgs.set(meta.id, list);
      c.chat = meta.id;
      s.chats.unshift(meta);
      meta = s.chats[0];
      addChat(meta).catch(failed);
    }
    meta.updated = Date.now();
    meta.n = Math.max(meta.n, i + 1);
    s.chats.splice(s.chats.indexOf(meta), 1);
    s.chats.unshift(meta);
    await putMessage(meta.id, i, list[i], meta.updated).catch(failed);
  }
  async function deleteChat(c: Config, id: string) {
    s.chats = s.chats.filter((x) => x.id !== id);
    msgs.delete(id);
    if (c.chat === id) c.chat = undefined;
    await dropChat(id).catch(failed);
  }

  const ratePerHr = computed(() => burnRatePerHr(s.pods));
  const groups = computed(() => sidebarGroups(s.configs, s.pods));
  const volumeStrays = computed(() => strayVolumes(s.configs, s.volumes));
  const podOf = (c: { podId?: string }) => s.pods.find((p) => p.id === c.podId);

  function state(c: { podId?: string }): ModelState {
    const pod = podOf(c);
    if (!pod) return "Off";
    if (s.answering === pod.id) return "Answering";
    return s.ready[pod.id] ? "On" : "Starting";
  }
  /** Minutes until the Pod's watchdog deletes it, counted from the last activity Hose saw; null when it never idles off. */
  const offInMin = (c: Config) => {
    if (!c.idleMin) return null;
    const since = s.lastActive[c.podId ?? ""];
    return since ? Math.min(c.idleMin, Math.max(0, Math.ceil(c.idleMin - (s.now - since) / 60000))) : c.idleMin;
  };

  const guard = (fn: () => Promise<void>) => () =>
    fn().then(
      () => (s.error = ""),
      (e) => (s.error = String(e.message ?? e)),
    );

  const refresh = guard(async () => {
    s.pods = await listHosePods(key());
    for (const c of s.configs) {
      const pod = podOf(c);
      if (c.podId && !pod) endRun(c); // watchdog or user deleted it
      // a deleted pod 404s, so its machine details are saved while it's alive
      else if (pod) {
        c.last = snapshotOf(pod, pod.dataCenterId ? await getDatacenterName(key(), pod.dataCenterId) : "", Date.now());
        if (pod.cost) c.price = pod.cost; // RunPod's real $/hr, shown as "Costs when on" once it's off
      }
    }
    await Promise.all(
      s.pods
        .filter((p) => !s.ready[p.id])
        .map(async (p) => {
          if (await podReady(p.id, vllmKey())) (s.ready[p.id] = true), (s.lastActive[p.id] ??= Date.now());
        }),
    );
    await backstop();
  });

  // Backup for the on-Pod watchdog while Hose is open: delete a pod that is well past its idle time, that used its
  // budget (counting the image pull the watchdog can't see), or that never became ready. The watchdog normally gets there first.
  async function backstop() {
    for (const c of s.configs) {
      const pod = podOf(c);
      if (!pod || s.answering === pod.id) continue;
      const idle = c.idleMin && s.ready[pod.id] && s.now - (s.lastActive[pod.id] ?? s.now) > (c.idleMin + 3) * 60000;
      const spent = c.budget && (c.last?.runSpend ?? 0) >= c.budget;
      const stuck = !s.ready[pod.id] && pod.createdAt && s.now - Date.parse(pod.createdAt) > 25 * 60000;
      if (idle || spent || stuck) await turnOff(c);
    }
  }

  const pollMoney = guard(async () => void (s.balance = await getBalance(key())));
  const pollVolumes = guard(async () => void (s.volumes = await listHoseVolumes(key())));

  // Other apps use the pod through its API (shown in Details): their requests count as activity, as the watchdog
  // counts them, so the backstop never deletes a pod in use. A pod's first reading only sets the baseline.
  const served: Record<string, number> = {}; // podId -> vLLM's finished-request count at the last poll
  const pollUse = () =>
    Promise.all(
      s.pods
        .filter((p) => s.ready[p.id])
        .map(async (p) => {
          const load = await podLoad(p.id, vllmKey());
          if (!load) return;
          if (load.busy || (p.id in served && load.done !== served[p.id])) touch(p.id);
          served[p.id] = load.done;
        }),
    );

  /**
   * Secure: the model lives on a network volume in one data center, made on the first Turn on, so later pods skip
   * the download. Resolves true when that data center had no free GPU and the pod went elsewhere without it.
   */
  async function turnOn(c: Config) {
    const dcs = await getDataCenters(key());
    const ids = c.location ? dcIds(c.location, dcs) : [];
    const size = c.disk ?? diskGb(c.params, c.draws);
    const input = (dcIds: string[], volumeId = "") =>
      podInput(c, c.gpuId, c.cloud, hfToken(), vllmKey(), c.idleMin, WATCHDOG, size, dcIds, budgetMin(c.budget, c.price), volumeId);
    // Community has no volumes, and a new location may leave the volume's data center out
    if (c.volumeId && (c.cloud !== "SECURE" || (ids.length && !ids.includes(c.volumeDc!)))) await removeStorage(c);
    if (c.cloud === "SECURE" && !c.volumeId) {
      const gpu = (await getGpus(key(), "SECURE")).find((g) => g.id === c.gpuId);
      const dc = gpu ? volumeDc(gpu, ids, dcs) : "";
      // no volume this run if RunPod won't make one; the next Turn on tries again
      const vol = dc ? await createVolume(key(), hoseName(c.id), size, dc).catch(() => null) : null;
      if (vol) Object.assign(c, { volumeId: vol.id, volumeDc: vol.dataCenter, volumeGb: vol.size, volumeAt: Date.now() });
    }
    if (c.volumeId && size > (c.volumeGb ?? 0)) {
      const { size: gb } = await resizeVolume(key(), c.volumeId, size);
      bankStorage(c, Date.now());
      c.volumeGb = gb;
    }
    let moved = false;
    let pod: Pod | null = null;
    if (c.volumeId) pod = await createPod(key(), input([c.volumeDc!], c.volumeId)).catch(() => ((moved = true), null));
    pod ??= await createPod(key(), input(ids));
    c.podId = pod.id;
    s.pods.push(pod);
    return moved;
  }
  async function turnOff(c: Config) {
    if (c.podId) await deletePod(key(), c.podId);
    endRun(c);
    await refresh();
  }
  /** Deletes the model's network volume: no storage bill, but the next Turn on downloads the model again. */
  async function removeStorage(c: Config) {
    if (c.volumeId) await removeVolume(c.volumeId);
    bankStorage(c, Date.now());
    Object.assign(c, { volumeId: undefined, volumeDc: undefined, volumeGb: undefined, volumeAt: undefined });
  }
  /** Deletes a network volume; one already gone (removed in RunPod's console, or another account's) counts as done. */
  async function removeVolume(id: string) {
    await deleteVolume(key(), id).catch((e) => {
      if (!String(e?.message).includes("RunPod error 404")) throw e;
    });
    s.volumes = s.volumes.filter((v) => v.id !== id);
  }
  /** A hose-* pod with no config on this Mac. */
  async function turnOffPod(id: string) {
    await deletePod(key(), id);
    await refresh();
  }
  /** Add a config, or replace the one with the same key (rename, Change GPU). */
  const save = (c: Config) => (s.configs = upsertConfig(s.configs, c));
  async function forget(c: Config) {
    if (c.podId) await turnOff(c);
    await removeStorage(c);
    s.configs = s.configs.filter((x) => x.key !== c.key);
    for (const x of chatsOf(c)) msgs.delete(x.id);
    msgs.delete(`new:${c.key}`);
    s.chats = s.chats.filter((x) => x.config !== c.key);
    await deleteChatsOf(c.key).catch(failed);
  }
  const touch = (podId: string) => (s.lastActive[podId] = Date.now());

  const TICK = 5;
  let ticks = 0;
  let polledKey = ""; // the RunPod key s.balance belongs to
  let running = false; // a slow poll (pod still booting) must not stack up behind the next tick
  const loop = async () => {
    if (!key() || running) return;
    running = true;
    // a new key may be another account: drop its balance and poll money this tick, not up to 30 s later
    if (key() !== polledKey) (polledKey = key()), (ticks = 0), (s.balance = null);
    s.now = Date.now();
    s.session += (ratePerHr.value * TICK) / 3600;
    // ponytail: /metrics every 30 s like the watchdog, before refresh so the backstop sees it
    if (ticks++ % 6 === 0) await Promise.all([pollMoney(), pollUse(), pollVolumes()]);
    await refresh();
    running = false;
  };
  const timer = setInterval(loop, TICK * 1000);
  onUnmounted(() => clearInterval(timer));

  return { s, chatOf, chatsOf, newChat, openChat, remember, deleteChat, groups, ratePerHr, podOf, state, offInMin, turnOn, turnOff, removeStorage, removeVolume, volumeStrays, turnOffPod, save, forget, touch, refresh, pollUse, start: loop };
}

export type Fleet = ReturnType<typeof useFleet>;
