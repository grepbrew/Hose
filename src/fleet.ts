// The user's models (remembered on this Mac) and their Pods on RunPod, polled while the app is open.
// Shared by CostBar, Models and Chat.
import { reactive, computed, watch, onUnmounted } from "vue";
import { listHosePods, createPod, deletePod, podReady, getBalance, type Pod } from "./api";
import { burnRatePerHr, podInput, type Cloud, type Model } from "./cost";
import WATCHDOG from "./watchdog.py?raw";

/** A model the user set up. Turn off deletes its Pod; this record is what Turn on rebuilds it from. */
export type Saved = Model & { gpuId: string; gpuName: string; cloud: Cloud; idleMin: number; podId?: string };
export type ModelState = "Off" | "Starting" | "On" | "Answering";

const STORE = "hose.models";
const load = (): Saved[] => {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? "[]");
  } catch {
    return [];
  }
};

export function useFleet(key: () => string, vllmKey: () => string, hfToken: () => string) {
  const s = reactive({
    models: load(),
    pods: [] as Pod[],
    ready: {} as Record<string, boolean>,
    lastActive: {} as Record<string, number>, // podId -> last chat activity (or ready time), ms
    answering: "",
    now: Date.now(),
    balance: null as number | null,
    session: 0,
    error: "",
  });
  // ponytail: model list in the webview's localStorage; nothing secret in it
  watch(() => s.models, (v) => localStorage.setItem(STORE, JSON.stringify(v)), { deep: true });

  const ratePerHr = computed(() => burnRatePerHr(s.pods));
  const podOf = (m: Saved) => s.pods.find((p) => p.id === m.podId);
  /** hose-* pods with no saved model (e.g. made on another Mac): still listed so they can be turned off. */
  const strays = computed(() => s.pods.filter((p) => !s.models.some((m) => m.podId === p.id)));

  function state(m: Saved): ModelState {
    const pod = podOf(m);
    if (!pod) return "Off";
    if (s.answering === pod.id) return "Answering";
    return s.ready[pod.id] ? "On" : "Starting";
  }
  /** Minutes until the Pod's watchdog deletes it, counted from the last activity Hose saw. */
  const offInMin = (m: Saved) => {
    const since = s.lastActive[m.podId ?? ""];
    return since ? Math.min(m.idleMin, Math.max(0, Math.ceil(m.idleMin - (s.now - since) / 60000))) : m.idleMin;
  };

  const guard = (fn: () => Promise<void>) => () =>
    fn().then(
      () => (s.error = ""),
      (e) => (s.error = String(e.message ?? e)),
    );

  const refresh = guard(async () => {
    s.pods = await listHosePods(key());
    for (const m of s.models) if (m.podId && !podOf(m)) m.podId = undefined; // watchdog or user deleted it
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
    for (const m of s.models) {
      const pod = podOf(m);
      if (!pod || s.answering === pod.id) continue;
      const idle = s.ready[pod.id] && s.now - (s.lastActive[pod.id] ?? s.now) > (m.idleMin + 3) * 60000;
      const stuck = !s.ready[pod.id] && pod.createdAt && s.now - Date.parse(pod.createdAt) > 25 * 60000;
      if (idle || stuck) await turnOff(m);
    }
  }

  const pollMoney = guard(async () => void (s.balance = await getBalance(key())));

  async function turnOn(m: Saved) {
    const pod = await createPod(key(), podInput(m, m.gpuId, m.cloud, hfToken(), vllmKey(), m.idleMin, WATCHDOG));
    m.podId = pod.id;
    s.pods.push(pod);
  }
  async function turnOff(m: { podId?: string }) {
    if (m.podId) await deletePod(key(), m.podId);
    m.podId = undefined;
    await refresh();
  }
  /** Remember a model on a GPU; replaces an Off model with the same id (Change GPU). */
  function save(m: Saved) {
    s.models = [...s.models.filter((x) => x.id !== m.id || x.podId), m];
  }
  async function forget(m: Saved) {
    if (m.podId) await turnOff(m);
    s.models = s.models.filter((x) => x !== m);
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

  return { s, ratePerHr, strays, state, offInMin, turnOn, turnOff, save, forget, touch, refresh, start: loop };
}

export type Fleet = ReturnType<typeof useFleet>;
