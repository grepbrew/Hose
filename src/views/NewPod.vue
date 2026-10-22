<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { hfSearch, hfModelInfo, hfCanDownload, type HfHit } from "../api";
import { PRESETS, parseHfModel, label, billions, vramNeededGb, type Cloud, type Config, type GpuCard, type Model, type Preset } from "../cost";
import type { Fleet } from "../fleet";
import GpuPicker from "./GpuPicker.vue";
import Icon from "./Icon.vue";

const props = defineProps<{ apiKey: string; hfToken: string; fleet: Fleet }>();
const emit = defineEmits<{ saved: [Config] }>();

const IDLE_CHOICES = [2, 5, 10, 20, 30, 60];
const SIZES = [
  ["S", "Small"],
  ["M", "Medium"],
  ["L", "Large"],
] as const;
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const downloads = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));

// ① Model
const size = ref<Preset["size"]>("M");
const model = ref<Model>(PRESETS.find((p) => p.size === "M")!);
const error = ref("");
const chips = computed(() => PRESETS.filter((p) => p.size === size.value));
const locked = (gated: unknown) => !!gated && !props.hfToken;

async function choose(m: Model, gated: unknown) {
  error.value = "";
  if (locked(gated)) return void (error.value = "This model is gated. Add a Hugging Face token under Settings › Keys first.");
  if (gated && !(await hfCanDownload(m.id, props.hfToken)))
    return void (error.value = `Accept the licence on huggingface.co/${m.id} with your Hugging Face account, then pick it again.`);
  model.value = { id: m.id, params: m.params };
  name.value = null;
}

const query = ref("");
const results = ref<HfHit[]>([]);
const searching = ref(false);
const pasted = computed(() => /^[\w.-]+\/[\w.-]+$/.test(query.value.trim().replace(/^https:\/\/huggingface\.co\//, "")));
let timer = 0;
watch(query, (q) => {
  clearTimeout(timer);
  if (!q.trim()) return void (results.value = []);
  timer = setTimeout(async () => {
    searching.value = true;
    try {
      results.value = await hfSearch(q.trim(), props.hfToken);
    } catch (e) {
      error.value = errorText(e);
    } finally {
      searching.value = false;
    }
  }, 300);
});
const checking = ref(false);
async function check() {
  error.value = "";
  checking.value = true;
  const id = query.value.trim().replace(/^https:\/\/huggingface\.co\//, "");
  try {
    const info = await hfModelInfo(id, props.hfToken);
    const r = parseHfModel(info, !!props.hfToken);
    if (!r.ok)
      error.value =
        r.reason === "needs Hugging Face token" ? "This model is gated. Add a Hugging Face token under Settings › Keys first." : `${id} is ${r.reason}. Hose runs text chat models only.`;
    else await choose(r.model, info.gated);
  } catch (e) {
    error.value = errorText(e);
  } finally {
    checking.value = false;
  }
}

// ② GPU
const cloud = ref<Cloud>("SECURE");
const gpu = ref<GpuCard | null>(null);

// ③ Name & idle
const name = ref<string | null>(null); // null = follow the model and GPU
const autoName = computed(() => `${label(model.value.id)} · ${gpu.value?.name ?? ""}`);
const idleMin = ref(10);

const busy = ref("");
function build(): Config {
  const g = gpu.value!;
  return {
    key: crypto.randomUUID(),
    name: name.value?.trim() || autoName.value,
    id: model.value.id,
    params: model.value.params,
    gpuId: g.id,
    gpuName: g.name,
    cloud: cloud.value,
    idleMin: idleMin.value,
    price: g.price,
    vram: g.memory,
    pastPodIds: [],
    spentPast: 0,
  };
}
async function save(turnOn: boolean) {
  error.value = "";
  busy.value = turnOn ? "on" : "save";
  const c = build();
  props.fleet.save(c);
  const saved = props.fleet.s.configs.find((x) => x.key === c.key)!;
  try {
    if (turnOn) await props.fleet.turnOn(saved);
    emit("saved", saved);
  } catch (e) {
    error.value = `Saved, but couldn't turn it on: ${errorText(e)}`;
    emit("saved", saved);
  } finally {
    busy.value = "";
  }
}
</script>

<template>
  <section class="page-col">
    <header class="bar" data-tauri-drag-region>
      <h1>New pod</h1>
    </header>

    <div class="scroll">
      <section class="panel" aria-labelledby="s1">
        <div class="head">
          <span class="step">1</span>
          <h2 id="s1" class="fill">Model</h2>
          <div class="seg" role="group" aria-label="Size">
            <button v-for="[id, text] in SIZES" :key="id" type="button" :aria-pressed="size === id" @click="size = id">{{ text }}</button>
          </div>
        </div>
        <div class="chips">
          <button v-for="c in chips" :key="c.id" class="pick res" type="button" :aria-pressed="model.id === c.id" @click="choose(c, c.gated)">
            <span class="row1">
              <strong>{{ c.label }}</strong>
              <span class="money muted">{{ billions(c.params) }}</span>
            </span>
            <span class="blurb muted">{{ c.blurb }}</span>
            <span class="tagline muted">
              <Icon v-if="c.gated" name="lock" :size="11" />
              {{ c.tag }}{{ c.gated ? (hfToken ? " · gated" : " · needs HF token") : "" }}
            </span>
          </button>
        </div>

        <div class="search">
          <label for="hf-search">Search Hugging Face</label>
          <div class="input-icon">
            <Icon name="magnifying-glass" class="muted" />
            <input id="hf-search" v-model="query" class="field" placeholder="Any chat model, or paste owner/model-name" spellcheck="false" autocomplete="off" />
          </div>
          <div v-if="pasted || results.length" class="results">
            <div class="results-head">Chat models, most downloaded first. Text in, text out.</div>
            <button v-if="pasted" class="result res" type="button" :disabled="checking" @click="check">
              <span class="id">{{ checking ? "Checking…" : "Check" }} {{ query.trim() }}</span>
            </button>
            <button v-for="r in results" :key="r.id" class="result res" type="button" :aria-pressed="model.id === r.id" @click="choose(r, r.gated)">
              <span class="id"><Icon v-if="r.gated" name="lock" :size="11" /> {{ r.id }}</span>
              <span class="money muted">{{ billions(r.params) }}</span>
              <span class="muted dl">↓ {{ downloads(r.downloads) }}</span>
              <span class="muted needs">needs ~{{ Math.ceil(vramNeededGb(r.params)) }} GB</span>
            </button>
          </div>
          <p v-else-if="query.trim() && !searching" class="muted small">No chat models match. Try another name.</p>
        </div>
      </section>

      <section class="panel" aria-labelledby="s2">
        <GpuPicker v-model:cloud="cloud" :api-key="apiKey" :model="model" :picked="gpu?.id" @pick="gpu = $event">
          <span class="step">2</span>
          <h2 id="s2">GPU</h2>
        </GpuPicker>
      </section>

      <section class="panel" aria-labelledby="s3">
        <div class="head">
          <span class="step">3</span>
          <h2 id="s3" class="fill">Name &amp; idle</h2>
        </div>
        <div class="two">
          <div class="fieldset">
            <label for="pod-name">Name</label>
            <input id="pod-name" class="field" :value="name ?? autoName" spellcheck="false" @input="name = ($event.target as HTMLInputElement).value" />
            <span class="small muted">Shown in the sidebar. You can rename it later.</span>
          </div>
          <div class="fieldset">
            <label for="idle">Turns off after</label>
            <select id="idle" v-model.number="idleMin" class="field">
              <option v-for="n in IDLE_CHOICES" :key="n" :value="n">{{ n }} quiet min</option>
            </select>
            <span class="small muted">Even if you close Hose.</span>
          </div>
        </div>
      </section>
    </div>

    <footer class="foot">
      <span v-if="error" class="grow error" role="alert">{{ error }}</span>
      <span v-else class="grow muted">You pay only while it's on.</span>
      <button class="btn big" type="button" :disabled="!gpu || !!busy" @click="save(false)">Save only</button>
      <button class="btn primary big" type="button" :disabled="!gpu || !!busy" @click="save(true)">
        {{ busy === "on" ? "Turning on…" : gpu ? `Turn on · ${gpu.name} · $${gpu.price.toFixed(2)}/hr` : "Turn on" }}
      </button>
    </footer>
  </section>
</template>

<style scoped>
.page-col {
  height: 100%;
  display: flex;
  flex-direction: column;
}
.bar {
  height: 52px;
  flex: none;
  display: flex;
  align-items: center;
  padding: 0 22px;
  border-bottom: 1px solid var(--line);
}
.bar h1 {
  font-size: 14.5px;
}
.scroll {
  flex-grow: 1;
  min-height: 0;
  overflow: auto;
  padding: 22px 28px 28px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.panel {
  width: 100%;
  max-width: 960px;
  align-self: center;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.panel h2 {
  font-size: 14px;
}
/* not ".head h2": that would also match GpuPicker's .head and stretch the slotted "GPU" title */
h2.fill {
  flex-grow: 1;
}
.panel :deep(.step),
.step {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--accent-soft);
  color: var(--accent);
  font-family: var(--pop);
  font-size: 11.5px;
  font-weight: 600;
}
.chips {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 8px;
}
.pick {
  font: inherit;
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 11px 13px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--surface);
  color: var(--ink);
  cursor: pointer;
  transition:
    border-color var(--dur) var(--ease-out),
    background var(--dur) var(--ease-out),
    box-shadow var(--dur) var(--ease-out),
    transform 120ms var(--ease-out);
}
.pick:hover {
  border-color: var(--muted);
}
.pick:active {
  transform: scale(0.985);
}
.pick[aria-pressed="true"] {
  border-color: var(--accent);
  background: var(--accent-soft);
  box-shadow: inset 0 0 0 1px var(--accent);
}
.res {
  animation: rise 220ms var(--ease-out) both;
}
.row1 {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 6px;
}
.row1 strong {
  font-size: 12.5px;
  font-weight: 600;
}
.row1 .money {
  font-size: 11px;
}
.blurb {
  font-size: 11.5px;
  line-height: 1.35;
}
.tagline {
  font-size: 10.5px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.search,
.fieldset {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.search label,
.fieldset label {
  font-size: 12px;
  font-weight: 600;
}
.input-icon {
  position: relative;
}
.input-icon svg {
  position: absolute;
  left: 11px;
  top: 10px;
}
.input-icon .field {
  padding-left: 34px;
}
.results {
  border: 1px solid var(--line);
  border-radius: 10px;
  overflow: hidden;
  margin-top: 2px;
}
.results-head {
  padding: 7px 12px;
  font-size: 11px;
  color: var(--muted);
  background: var(--paper);
}
.result {
  font: inherit;
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  text-align: left;
  padding: 9px 12px;
  border: 0;
  border-top: 1px solid var(--line);
  background: transparent;
  color: var(--ink);
  cursor: pointer;
  transition: background var(--dur) var(--ease-out);
}
.result:hover {
  background: var(--hover);
}
.result[aria-pressed="true"] {
  background: var(--accent-soft);
}
.result .id {
  flex-grow: 1;
  min-width: 0;
  font-size: 12.5px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.result .money {
  font-size: 11.5px;
}
.dl {
  font-size: 11.5px;
  width: 64px;
  text-align: right;
}
.needs {
  font-size: 11px;
  width: 104px;
  text-align: right;
}
.small {
  font-size: 11px;
}
.two {
  display: grid;
  grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
  gap: 12px;
}
.foot {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 28px;
  border-top: 1px solid var(--line);
  background: var(--paper);
}
.grow {
  flex-grow: 1;
  font-size: 12px;
}
</style>
