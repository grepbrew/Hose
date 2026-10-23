<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { getGpus } from "../api";
import { QUICK, PRESETS, gpuCards, recommend, newConfig, moveTo, diskGb, volumePerMo, usd, type Config, type Gpu, type Preset } from "../cost";
import type { Fleet } from "../fleet";
import Icon from "./Icon.vue";

// New pod's first view: one card per job. Start runs that preset on Secure cloud, on the GPU Hose recommends.
const props = defineProps<{ apiKey: string; fleet: Fleet }>();
const emit = defineEmits<{ saved: [Config]; customize: [Preset]; browse: [] }>();
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

const catalog = ref<Gpu[]>([]);
const loading = ref(true);
const error = ref("");
async function load() {
  loading.value = true;
  error.value = "";
  try {
    catalog.value = await getGpus(props.apiKey, "SECURE");
  } catch (e) {
    error.value = `Couldn't load GPU prices: ${errorText(e)}`;
  } finally {
    loading.value = false;
  }
}
onMounted(load);

const presetOf = (id: string) => PRESETS.find((p) => p.id === id)!;
const cards = computed(() =>
  QUICK.map((q) => {
    const preset = presetOf(q.id);
    const gpus = gpuCards(catalog.value, "SECURE", preset);
    // Start reuses the newest saved config of this model rather than making another
    const saved = props.fleet.s.configs.filter((c) => c.id === q.id).at(-1);
    const on = !!saved && props.fleet.state(saved) !== "Off";
    // ponytail: a saved config on Community or pinned to a location starts as it is; only Secure-anywhere ones follow the pick
    const follows = saved?.cloud === "SECURE" && !saved.location;
    const own = follows ? gpus.find((g) => g.fits && g.id === saved!.gpuId) : undefined;
    const gpu = own ?? recommend(gpus);
    return { ...q, preset, saved, on, follows, gpu, price: on ? saved!.price : gpu?.price, where: on ? saved!.gpuName : gpu?.name };
  }),
);
type Card = (typeof cards.value)[number];
const soldOut = computed(() => !loading.value && !error.value && cards.value.every((c) => !c.on && !c.gpu));
const canStart = (c: Card) => c.on || (!!c.gpu && !busy.value);
// keeping a model ready = its network volume, billed monthly
const storage = computed(() => QUICK.map((q) => volumePerMo(diskGb(presetOf(q.id).params))));

const busy = ref("");
async function start(c: Card) {
  if (c.on) return emit("saved", c.saved!);
  error.value = "";
  busy.value = c.purpose;
  let config = c.saved;
  try {
    if (!config) {
      const fresh = newConfig(c.preset, c.gpu!, c.think ? { think: true } : {});
      props.fleet.save(fresh);
      config = props.fleet.s.configs.find((x) => x.key === fresh.key)!;
    } else if (c.follows && c.gpu && c.gpu.id !== config.gpuId) moveTo(config, c.gpu); // its GPU sold out since
    await props.fleet.turnOn(config);
    emit("saved", config);
  } catch (e) {
    error.value = config ? `Saved, but couldn't turn it on: ${errorText(e)}` : errorText(e);
  } finally {
    busy.value = "";
  }
}
</script>

<template>
  <div class="quick">
    <div class="intro">
      <h2>What do you want help with?</h2>
      <p class="muted">Pick one and start chatting. Hose rents a GPU that runs it smoothly, and turns it off when you stop.</p>
    </div>

    <div class="grid">
      <article v-for="c in cards" :key="c.purpose" class="qcard" :aria-labelledby="`q-${c.icon}`">
        <div class="title">
          <span class="tile"><Icon :name="c.icon" :size="20" /></span>
          <span class="words">
            <h3 :id="`q-${c.icon}`">{{ c.purpose }}</h3>
            <span class="muted blurb">{{ c.blurb }}</span>
          </span>
        </div>
        <div class="model muted">
          <span class="ellipsis">{{ c.preset.label }} · {{ c.preset.tag.split(" · ")[0] }}</span>
          <span v-if="c.on" class="pill on">On</span>
          <span v-else-if="c.saved" class="pill">Saved</span>
          <span v-else-if="c.gpu" class="pill">{{ c.gpu.tier === "smooth" ? c.gpu.note : "Works, slower" }}</span>
          <span v-else-if="!loading" class="pill dim">Sold out</span>
        </div>
        <div class="price">
          <template v-if="c.price != null">
            <span class="money">{{ usd(c.price) }}/hr</span>
            <span class="muted small">on {{ c.where }}{{ c.on ? " · on now" : "" }}</span>
          </template>
          <span v-else-if="loading" class="muted small">Checking GPU prices…</span>
          <template v-else>
            <span class="money">No GPU free</span>
            <span class="muted small">right now</span>
          </template>
        </div>
        <div class="actions">
          <button class="btn primary" type="button" :disabled="!canStart(c)" :aria-label="`${c.on ? 'Open' : 'Start'} ${c.purpose}`" @click="start(c)">
            {{ busy === c.purpose ? "Starting…" : c.on ? "Open chat" : c.saved ? "Start again" : "Start chatting" }}
          </button>
          <button class="btn quiet" type="button" @click="emit('customize', c.preset)">Customize</button>
        </div>
      </article>

      <button class="qcard own" type="button" @click="emit('browse')">
        <span class="title">
          <span class="tile plain"><Icon name="sliders-horizontal" :size="20" /></span>
          <span class="words">
            <span class="h3">Choose a model yourself</span>
            <span class="muted blurb">Search any chat model on Hugging Face. Filter by price, size or maker. Hose still picks the GPU.</span>
          </span>
        </span>
        <span class="browse">Browse models <Icon name="arrow-right" :size="14" /></span>
      </button>
    </div>

    <p v-if="error" class="error small" role="alert">
      {{ error }} <button v-if="!catalog.length" type="button" class="link" @click="load">Try again</button>
    </p>
    <p v-if="soldOut" role="status" class="small">No GPU free right now on RunPod's Secure cloud. Try again in a few minutes, or choose a model yourself and switch to Community cloud.</p>
    <p class="muted small foot">
      You pay the hourly price only while a chat is on. Keeping a model ready to start fast costs about {{ usd(Math.min(...storage)) }}–{{ usd(Math.max(...storage)) }} a month each;
      remove it any time. Every chat turns itself off after 10 quiet minutes, even if you close Hose.
    </p>
  </div>
</template>

<style scoped>
.quick {
  width: 100%;
  max-width: 980px;
  align-self: center;
  display: flex;
  flex-direction: column;
  gap: 22px;
  padding-top: 14px;
}
.intro {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.intro h2 {
  font-size: 22px;
  letter-spacing: -0.01em;
}
.intro p {
  font-size: 13px;
  line-height: 1.45;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(270px, 1fr));
  gap: 12px;
}
.qcard {
  font: inherit;
  color: inherit;
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 18px;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--surface);
  transition:
    border-color var(--dur) var(--ease-out),
    box-shadow var(--dur) var(--ease-out);
  animation: rise 240ms var(--ease-out) both;
}
.qcard:hover {
  border-color: var(--muted);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
}
.qcard:nth-child(2) {
  animation-delay: 40ms;
}
.qcard:nth-child(3) {
  animation-delay: 80ms;
}
.qcard:nth-child(4) {
  animation-delay: 120ms;
}
.qcard:nth-child(5) {
  animation-delay: 160ms;
}
.qcard:nth-child(6) {
  animation-delay: 200ms;
}
.title {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}
.tile {
  width: 36px;
  height: 36px;
  flex: none;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--accent-soft);
  color: var(--accent);
}
.tile.plain {
  background: var(--hover);
  color: var(--ink);
}
.words {
  flex-grow: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.words h3,
.words .h3 {
  font-family: var(--pop);
  font-size: 14.5px;
  font-weight: 600;
}
.blurb {
  font-size: 12px;
  line-height: 1.4;
}
.model {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 11.5px;
}
.ellipsis {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pill {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 8px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 500;
  background: var(--accent-soft);
  color: var(--accent);
  white-space: nowrap;
}
.pill.on {
  background: var(--accent);
  color: var(--accent-ink);
}
.pill.dim {
  background: var(--hover);
  color: var(--muted);
}
.price {
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding-top: 10px;
  border-top: 1px solid var(--line);
}
.price .money {
  font-size: 18px;
  font-weight: 600;
}
.actions {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: auto;
}
.actions .btn {
  height: 36px;
}
.actions .primary {
  flex-grow: 1;
}
.own {
  border-style: dashed;
  background: transparent;
  cursor: pointer;
}
.own:hover {
  background: var(--surface);
}
.browse {
  margin-top: auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  font-weight: 500;
  color: var(--accent);
}
.small {
  font-size: 12px;
  line-height: 1.5;
}
</style>
