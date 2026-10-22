// The user's pod configs (remembered on this Mac) and their Pods on RunPod, polled while the app is open.
// Shared by the Sidebar, New pod and pod pages.
import { reactive, computed, watch, onUnmounted } from "vue";
import { listHosePods, createPod, deletePod, podReady, getBalance, getDatacenterName, getDataCenters, type Message, type Pod } from "./api";
import { burnRatePerHr, podInput, dcIds, migrateConfigs, upsertConfig, snapshotOf, endRun, sidebarGroups, type Config } from "./cost";
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
  /** Minutes until the Pod's watchdog deletes it, counted from the last activity Hose saw. */
  const offInMin = (c: Config) => {
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

  // Backup for the on-Pod watchdog while Hose is open: delete a pod that is well past its idle time,
  // or that never became ready. The watchdog normally gets there first.
  async function backstop() {
    for (const c of s.configs) {
      const pod = podOf(c);
      if (!pod || s.answering === pod.id) continue;
      const idle = s.ready[pod.id] && s.now - (s.lastActive[pod.id] ?? s.now) > (c.idleMin + 3) * 60000;
      const stuck = !s.ready[pod.id] && pod.createdAt && s.now - Date.parse(pod.createdAt) > 25 * 60000;
      if (idle || stuck) await turnOff(c);
    }
  }

  const pollMoney = guard(async () => void (s.balance = await getBalance(key())));

  async function turnOn(c: Config) {
    const ids = c.location ? dcIds(c.location, await getDataCenters(key())) : [];
    const pod = await createPod(key(), podInput(c, c.gpuId, c.cloud, hfToken(), vllmKey(), c.idleMin, WATCHDOG, c.disk, ids));
    c.podId = pod.id;
    s.pods.push(pod);
  }
  async function turnOff(c: Config) {
    if (c.podId) await deletePod(key(), c.podId);
    endRun(c);
    await refresh();
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
    await refresh();
    if (ticks++ % 6 === 0) await pollMoney();
    running = false;
  };
  const timer = setInterval(loop, TICK * 1000);
  onUnmounted(() => clearInterval(timer));

  return { s, chatOf, groups, ratePerHr, podOf, state, offInMin, turnOn, turnOff, turnOffPod, save, forget, touch, refresh, start: loop };
}

export type Fleet = ReturnType<typeof useFleet>;
