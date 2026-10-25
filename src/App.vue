<script setup lang="ts">
import { ref, computed, watch, onMounted } from "vue";
import { useFleet } from "./fleet";
import { loadKeys, saveKeys, type Keys } from "./secrets";
import { initialSelection, type Sel } from "./cost";
import Sidebar from "./views/Sidebar.vue";
import Setup from "./views/Setup.vue";
import NewPod from "./views/NewPod.vue";
import PodPage from "./views/PodPage.vue";

const loaded = ref(false);
const keys = ref<Keys>({ runpod: "", hf: "", vllm: "" });
const fleet = useFleet(
  () => keys.value.runpod,
  () => keys.value.vllm,
  () => keys.value.hf,
);

// The page in the content area, remembered across launches.
const SEL = "hose.sel";
const stored = (): Sel | null => {
  try {
    return JSON.parse(localStorage.getItem(SEL) ?? "null");
  } catch {
    return null;
  }
};
const sel = ref<Sel>({ kind: "new" });
watch(sel, (v) => {
  try {
    localStorage.setItem(SEL, JSON.stringify(v));
  } catch {}
});
const pick = (from: Sel | null) => initialSelection(from, fleet.s.configs, fleet.s.pods);

async function use(k: Keys) {
  keys.value = k;
  if (k.runpod) {
    await fleet.start();
    sel.value = pick(stored());
  }
  loaded.value = true;
}
const keyError = ref("");
// The keys are read once per launch; Setup gets them as props and hands back what it saved.
async function boot() {
  keyError.value = "";
  let k: Keys;
  try {
    k = await loadKeys();
    // One random key per Mac guards every pod's public vLLM URL; only Hose and the pod know it.
    if (!k.vllm) {
      k.vllm = crypto.randomUUID();
      await saveKeys(k);
    }
  } catch (e) {
    // Unreadable saved keys: say so instead of a blank window.
    keyError.value = e instanceof Error ? e.message : String(e);
    return;
  }
  await use(k);
}
onMounted(boot);

const config = computed(() => (sel.value.kind === "config" ? fleet.s.configs.find((c) => c.key === (sel.value as { key: string }).key) : undefined));
const stray = computed(() => (sel.value.kind === "stray" ? fleet.s.pods.find((p) => p.id === (sel.value as { podId: string }).podId) : undefined));
// A deleted config or a stray that was turned off: show the next best page.
watch([config, stray], () => {
  if ((sel.value.kind === "config" && !config.value) || (sel.value.kind === "stray" && !stray.value)) sel.value = pick(null);
});

// Settings › Keys returns to the page it was opened from.
let back: Sel = { kind: "new" };
function select(s: Sel) {
  if (s.kind === "keys" && sel.value.kind !== "keys") back = sel.value;
  sel.value = s;
}
function keysSaved(k: Keys) {
  keys.value = k;
  void fleet.start(); // poll now with the new key instead of on the next tick
  sel.value = pick(back);
}
</script>

<template>
  <template v-if="loaded">
    <Setup v-if="!keys.runpod" :keys="keys" @saved="use" />
    <div v-else class="shell">
      <Sidebar :fleet="fleet" :sel="sel" @select="select" />
      <main class="content">
        <p v-if="fleet.s.error" class="banner error" role="alert">{{ fleet.s.error }}</p>
        <Transition name="page" mode="out-in">
          <NewPod v-if="sel.kind === 'new'" key="new" :api-key="keys.runpod" :hf-token="keys.hf" :fleet="fleet" @saved="(c) => (sel = { kind: 'config', key: c.key })" />
          <Setup v-else-if="sel.kind === 'keys'" key="keys" embedded :keys="keys" @saved="keysSaved" @cancel="sel = pick(back)" />
          <PodPage v-else-if="config" :key="config.key" :config="config" :fleet="fleet" :api-key="keys.runpod" :vllm-key="keys.vllm" />
          <PodPage v-else-if="stray" :key="stray.id" :stray="stray" :fleet="fleet" :api-key="keys.runpod" :vllm-key="keys.vllm" />
        </Transition>
      </main>
    </div>
  </template>
  <div v-else class="boot" data-tauri-drag-region>
    <template v-if="keyError">
      <p class="error" role="alert">Hose couldn't read your saved keys: {{ keyError }}</p>
      <button class="btn primary" @click="boot">Try again</button>
    </template>
    <p v-else class="muted">Reading your keys…</p>
  </div>
</template>

<style scoped>
.boot {
  height: 100vh;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 12px;
  padding: 0 24px;
  text-align: center;
}
.shell {
  height: 100vh;
  display: grid;
  grid-template-columns: 232px minmax(0, 1fr);
}
.content {
  min-width: 0;
  height: 100vh;
  display: flex;
  flex-direction: column;
}
.content > :not(.banner) {
  flex-grow: 1;
  min-height: 0;
}
.banner {
  flex: none;
  margin: 0;
  padding: 8px 22px;
  font-size: 12px;
  background: var(--surface);
  border-bottom: 1px solid var(--line);
}
</style>
