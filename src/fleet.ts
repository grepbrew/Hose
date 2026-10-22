// The user's pod configs (remembered on this Mac) and their Pods on RunPod, polled while the app is open.
// Shared by the Sidebar, New pod and pod pages.
import { reactive, computed, watch, onUnmounted } from "vue";
import { listHosePods, createPod, deletePod, createVolume, deleteVolume, resizeVolume, podReady, podLoad, getBalance, getGpus, getDatacenterName, getDataCenters, type Message, type Pod } from "./api";
import { burnRatePerHr, podInput, dcIds, diskGb, volumeDc, hoseName, migrateConfigs, upsertConfig, snapshotOf, endRun, sidebarGroups, budgetMin, type Config } from "./cost";
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
    ready: {} as Record<string, boolean>,
    lastActive: {} as Record<string, number>, // podId -> last chat activity (or ready time), ms
    answering: "",
    now: Date.now(),
    balance: null as number | null,
    session: 0,
    error: "",
  });
  // ponytail: configs in the webview's localStorage; nothing secret in them
  watch(() => s.configs, (v) => localStorage.setItem(STORE, JSON.stringify(v)), { deep: true });

  // ponytail: chat history in memory only, one list per config, gone when Hose quits
  const chats = reactive(new Map<string, Message[]>());
  const chatOf = (c: Config) => (chats.has(c.key) ? chats.get(c.key)! : (chats.set(c.key, []), chats.get(c.key)!));

  const ratePerHr = computed(() => burnRatePerHr(s.pods));
  const groups = computed(() => sidebarGroups(s.configs, s.pods));
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
    const size = c.disk ?? diskGb(c.params);
    const input = (dcIds: string[], volumeId = "") =>
      podInput(c, c.gpuId, c.cloud, hfToken(), vllmKey(), c.idleMin, WATCHDOG, size, dcIds, budgetMin(c.budget, c.price), volumeId);
    // Community has no volumes, and a new location may leave the volume's data center out
    if (c.volumeId && (c.cloud !== "SECURE" || (ids.length && !ids.includes(c.volumeDc!)))) await removeStorage(c);
    if (c.cloud === "SECURE" && !c.volumeId) {
      const gpu = (await getGpus(key(), "SECURE")).find((g) => g.id === c.gpuId);
      const dc = gpu ? volumeDc(gpu, ids, dcs) : "";
      // no volume this run if RunPod won't make one; the next Turn on tries again
      const vol = dc ? await createVolume(key(), hoseName(c.id), size, dc).catch(() => null) : null;
      if (vol) Object.assign(c, { volumeId: vol.id, volumeDc: vol.dataCenter, volumeGb: vol.size });
    }
    if (c.volumeId && size > (c.volumeGb ?? 0)) c.volumeGb = (await resizeVolume(key(), c.volumeId, size)).size;
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
    if (c.volumeId) await deleteVolume(key(), c.volumeId);
    Object.assign(c, { volumeId: undefined, volumeDc: undefined, volumeGb: undefined });
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
    chats.delete(c.key);
  }
  const touch = (podId: string) => (s.lastActive[podId] = Date.now());

  const TICK = 5;
  let ticks = 0;
  let running = false; // a slow poll (pod still booting) must not stack up behind the next tick
  const loop = async () => {
    if (!key() || running) return;
    running = true;
    s.now = Date.now();
    s.session += (ratePerHr.value * TICK) / 3600;
    // ponytail: /metrics every 30 s like the watchdog, before refresh so the backstop sees it
    if (ticks++ % 6 === 0) await Promise.all([pollMoney(), pollUse()]);
    await refresh();
    running = false;
  };
  const timer = setInterval(loop, TICK * 1000);
  onUnmounted(() => clearInterval(timer));

  return { s, chatOf, groups, ratePerHr, podOf, state, offInMin, turnOn, turnOff, removeStorage, turnOffPod, save, forget, touch, refresh, pollUse, start: loop };
}

export type Fleet = ReturnType<typeof useFleet>;
