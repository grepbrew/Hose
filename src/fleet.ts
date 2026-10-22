// Live state of the user's Hose endpoints, polled while the app is open. Shared by CostBar and Models.
import { reactive, computed, onUnmounted } from "vue";
import { listHoseEndpoints, getWorkers, getGpus, getBalance, endpointCostToday, type Endpoint, type Worker } from "./api";
import { burnRatePerHr, type Gpu } from "./cost";

export function useFleet(key: () => string) {
  const s = reactive({
    endpoints: [] as Endpoint[],
    workers: {} as Record<string, Worker[]>,
    costToday: {} as Record<string, number>,
    gpus: [] as Gpu[],
    balance: null as number | null,
    session: 0,
    error: "",
  });

  const prices = computed(() => Object.fromEntries(s.gpus.map((g) => [g.id, g.price.serverless])));
  const ratePerHr = computed(() => burnRatePerHr(Object.values(s.workers).flat(), prices.value));

  const guard = (fn: () => Promise<void>) => () =>
    fn().then(
      () => (s.error = ""),
      (e) => (s.error = String(e.message ?? e)),
    );

  const refresh = guard(async () => {
    s.endpoints = await listHoseEndpoints(key());
    const ids = new Set(s.endpoints.map((e) => e.id));
    for (const id of Object.keys(s.workers)) if (!ids.has(id)) delete s.workers[id];
  });
  const pollWorkers = guard(async () => {
    await Promise.all(s.endpoints.map(async (e) => (s.workers[e.id] = await getWorkers(key(), e.id))));
  });
  const pollMoney = guard(async () => {
    s.balance = await getBalance(key());
    await Promise.all(s.endpoints.map(async (e) => (s.costToday[e.id] = await endpointCostToday(key(), e.id))));
  });

  const TICK = 5;
  let ticks = 0;
  const loop = async () => {
    if (!key()) return;
    s.session += (ratePerHr.value * TICK) / 3600;
    if (ticks % 6 === 0) await refresh();
    await pollWorkers();
    if (ticks % 6 === 0) await pollMoney();
    ticks++;
  };

  const start = async () => {
    if (!s.gpus.length) await guard(async () => void (s.gpus = await getGpus(key())))();
    await loop();
  };
  const timer = setInterval(loop, TICK * 1000);
  onUnmounted(() => clearInterval(timer));

  return { s, ratePerHr, prices, refresh: async () => (await refresh(), await pollWorkers()), start };
}

export type Fleet = ReturnType<typeof useFleet>;
