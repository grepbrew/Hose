<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { getGpus, getDataCenters, hfSearch, hfModelInfo, hfCanDownload, type HfHit } from "../api";
import {
  PRESETS,
  parseHfModel,
  label,
  billions,
  gpuCards,
  recommend,
  filterModels,
  newConfig,
  diskGb,
  fitDisk,
  weightsGb,
  allDay,
  volumePerMo,
  placeName,
  regionsOf,
  usd,
  type Cloud,
  type Config,
  type DataCenter,
  type Gpu,
  type GpuCard,
  type HfReject,
  type Model,
  type ModelFilter,
} from "../cost";
import type { Fleet } from "../fleet";
import GpuPicker from "./GpuPicker.vue";
import QuickStart from "./QuickStart.vue";
import Icon from "./Icon.vue";

const props = defineProps<{ apiKey: string; hfToken: string; fleet: Fleet }>();
const emit = defineEmits<{ saved: [Config] }>();

const IDLE_CHOICES = [2, 5, 10, 20, 30, 60];
const SIZES = [
  ["", "Any size", ""],
  ["S", "Small", "Under 7B"],
  ["M", "Medium", "7B to 20B"],
  ["L", "Large", "Over 20B"],
] as const;
const PRICES = [
  [0, "Any price"],
  [0.5, "Under $0.50/hr"],
  [1, "Under $1/hr"],
  [2, "Under $2/hr"],
] as const;
// Hugging Face owner → the maker people know
const MAKERS: Record<string, string> = { Qwen: "Qwen", "meta-llama": "Meta", google: "Google", microsoft: "Microsoft", "ibm-granite": "IBM", openai: "OpenAI", "deepseek-ai": "DeepSeek", mistralai: "Mistral" };
const SORTS = [
  ["downloads", "Most used"],
  ["trendingScore", "Trending"],
  ["createdAt", "Newest"],
  ["cheap", "Cheapest to run"],
] as const;
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const downloads = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));

// Quick start cards first; "Choose a model yourself" swaps in the browser below.
const advanced = ref(false);

// ① Model
const model = ref<Model>(PRESETS.find((p) => p.label === "Qwen3.5-9B")!);
const error = ref("");
const locked = (gated: unknown) => !!gated && !props.hfToken;
const GATED = "This model is gated. Add a Hugging Face token under Settings › Keys first.";
const WHY: Record<HfReject, string> = {
  gated: GATED,
  "not-chat": "That's not a chat model. Hose runs text chat models only.",
  "no-weights": "That model has no safetensors weights, so Hose can't size or run it.",
  "no-template": "That model has no chat template (likely a base model). Pick its Instruct or chat version.",
};

async function choose(m: Model, gated: unknown) {
  error.value = "";
  if (locked(gated)) return void (error.value = GATED);
  if (gated && !(await hfCanDownload(m.id, props.hfToken)))
    return void (error.value = `Accept the licence on huggingface.co/${m.id} with your Hugging Face account, then pick it again.`);
  model.value = { id: m.id, params: m.params };
  gpu.value = null; // the picker picks this model's recommended GPU
  name.value = null;
  disk.value = null;
}
function customize(p: Model & { gated?: boolean }) {
  advanced.value = true;
  void choose(p, p.gated);
}

const filter = ref<ModelFilter>({ size: "", maxPrice: 0, maker: "", thinking: false, hideGated: false, sort: "downloads" });
const query = ref("");
const results = ref<HfHit[]>([]);
const searching = ref(false);
const pasted = computed(() => /^[\w.-]+\/[\w.-]+$/.test(query.value.trim().replace(/^https:\/\/huggingface\.co\//, "")));
let timer = 0;
watch([query, () => filter.value.maker, () => filter.value.sort], ([q, author, sort]) => {
  clearTimeout(timer);
  if (!q.trim()) return void (results.value = []);
  timer = setTimeout(async () => {
    searching.value = true;
    try {
      results.value = await hfSearch(q.trim(), props.hfToken, { author, sort: sort === "cheap" ? "downloads" : sort });
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
    if (!r.ok) error.value = WHY[r.reason];
    else await choose(r.model, info.gated);
  } catch (e) {
    error.value = errorText(e);
  } finally {
    checking.value = false;
  }
}

// ② GPU
const cloud = ref<Cloud>("SECURE");
const location = ref("");
const gpu = ref<GpuCard | null>(null);
// the same catalog as the picker (cached a minute): prices the model list and fills the location choices
const catalog = ref<Gpu[]>([]);
const dcs = ref<DataCenter[]>([]);
watch(cloud, async (c) => (catalog.value = await getGpus(props.apiKey, c).catch(() => [])), { immediate: true });
getDataCenters(props.apiKey).then((list) => (dcs.value = list), () => {});
const regions = computed(() => regionsOf(catalog.value, dcs.value));

// The list: Hose's picks until a search, each priced on the GPU it would get
type Row = Model & { label: string; downloads: number; gated?: boolean | string; thinks: boolean };
const rows = computed(() => {
  const base: Row[] = query.value.trim() ? results.value.map((r) => ({ ...r, label: r.id.split("/")[1] })) : PRESETS.map((p) => ({ ...p, downloads: 0 }));
  const priced = base.map((m) => {
    const cards = gpuCards(catalog.value, cloud.value, m);
    const best = recommend(cards);
    const fit = best ? `${best.note} · ${best.name}` : cards.some((c) => c.tier === "sold-out") ? "No GPU free right now" : "Too big for one GPU";
    return { ...m, best, fit, price: best?.price ?? null };
  });
  return filterModels(priced, filter.value);
});
const maker = (id: string) => MAKERS[id.split("/")[0]] ?? id.split("/")[0];

// ③ More options
const name = ref<string | null>(null); // null = follow the model and GPU
const autoName = computed(() => `${label(model.value.id)} · ${gpu.value?.name ?? ""}`);
const idleMin = ref(10);
const budget = ref<number | null>(null); // $ per run; null = no limit
const allDayCost = computed(() => (idleMin.value || budget.value || !gpu.value ? null : allDay(gpu.value.price))); // set = on 24/7
const recDisk = computed(() => diskGb(model.value.params));
const disk = ref<number | null>(null); // null = follow the model's recommended size
// Only raising it is allowed: below the recommendation the model may not fit.
function setDisk(e: Event) {
  const el = e.target as HTMLInputElement;
  const gb = fitDisk(Number(el.value), model.value.params);
  disk.value = gb > recDisk.value ? gb : null;
  el.value = String(gb);
}

const busy = ref("");
const build = (): Config =>
  newConfig(model.value, gpu.value!, {
    ...(name.value?.trim() ? { name: name.value.trim() } : {}),
    cloud: cloud.value,
    location: location.value || undefined,
    disk: disk.value ?? recDisk.value,
    idleMin: idleMin.value,
    budget: budget.value || undefined,
  });
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
      <button v-if="advanced" class="btn quiet back" type="button" @click="advanced = false"><Icon name="arrow-right" :size="14" class="flip" /> Quick start</button>
      <h1>{{ advanced ? "Choose a model yourself" : "New pod" }}</h1>
    </header>

    <div class="scroll">
      <QuickStart v-if="!advanced" :api-key="apiKey" :fleet="fleet" @saved="emit('saved', $event)" @customize="customize" @browse="advanced = true" />

      <template v-else>
        <section class="panel" aria-labelledby="s1">
          <div class="head">
            <span class="step">1</span>
            <h2 id="s1" class="fill">Model</h2>
          </div>

          <div class="search">
            <label for="hf-search">Search Hugging Face</label>
            <div class="input-icon">
              <Icon name="magnifying-glass" class="muted" />
              <input id="hf-search" v-model="query" class="field" placeholder="Any chat model, or paste owner/model-name" spellcheck="false" autocomplete="off" />
            </div>
          </div>

          <div class="filters">
            <div class="seg" role="group" aria-label="Size">
              <button v-for="[id, text, title] in SIZES" :key="id" type="button" :title="title" :aria-pressed="filter.size === id" @click="filter.size = id">{{ text }}</button>
            </div>
            <select v-model.number="filter.maxPrice" class="field" aria-label="Max price">
              <option v-for="[n, text] in PRICES" :key="n" :value="n">{{ text }}</option>
            </select>
            <select v-model="filter.maker" class="field" aria-label="Maker">
              <option value="">Any maker</option>
              <option v-for="(text, id) in MAKERS" :key="id" :value="id">{{ text }}</option>
            </select>
            <select v-model="filter.sort" class="field" aria-label="Sort models">
              <option v-for="[id, text] in SORTS" :key="id" :value="id">{{ text }}</option>
            </select>
            <button class="toggle" type="button" :aria-pressed="filter.thinking" @click="filter.thinking = !filter.thinking"><Icon name="brain" :size="14" /> Thinking models</button>
            <button class="toggle" type="button" :aria-pressed="filter.hideGated" @click="filter.hideGated = !filter.hideGated">Hide ones that need a token</button>
          </div>

          <div class="results">
            <div class="cols results-head">
              <span>{{ query.trim() ? "Chat models on Hugging Face" : "Hose's picks" }}</span><span>Maker</span><span>Size</span><span>Used</span><span>Price</span><span>On its best GPU</span>
            </div>
            <button v-if="pasted" class="result res" type="button" :disabled="checking" @click="check">
              <span class="id">{{ checking ? "Checking…" : "Check" }} {{ query.trim() }}</span>
            </button>
            <button v-for="r in rows" :key="r.id" class="cols result res" type="button" :aria-pressed="model.id === r.id" @click="choose(r, r.gated)">
              <span class="id">
                <span class="ellipsis">{{ r.label }}</span>
                <span v-if="r.thinks" class="pill dim" title="Can think step by step before answering">thinks</span>
                <span v-if="r.gated" class="pill dim" title="Needs a Hugging Face token"><Icon name="lock" :size="10" /> token</span>
              </span>
              <span class="muted">{{ maker(r.id) }}</span>
              <span class="muted money">{{ billions(r.params) }}</span>
              <span class="muted">{{ r.downloads ? `↓ ${downloads(r.downloads)}` : "Hose pick" }}</span>
              <span class="money">{{ r.price != null ? `≈ ${usd(r.price)}/hr` : "—" }}</span>
              <span class="pill fit" :class="{ dim: r.best?.tier !== 'smooth' }">{{ r.fit }}</span>
            </button>
            <p v-if="searching && !rows.length" class="none muted">Searching…</p>
            <p v-else-if="!rows.length" class="none muted">
              {{ query.trim() && !results.length ? "No chat models match. Try another name." : "No model matches these filters. Try a higher price or another size." }}
            </p>
          </div>
        </section>

        <section class="panel" aria-labelledby="s2">
          <GpuPicker v-model:cloud="cloud" v-model:location="location" compact :api-key="apiKey" :model="model" :picked="gpu?.id" @pick="gpu = $event">
            <span class="step">2</span>
            <h2 id="s2">GPU</h2>
          </GpuPicker>
        </section>

        <details class="panel more">
          <summary>
            <span class="step">3</span>
            <span class="pop fill">More options</span>
            <span class="muted small">Name, cloud, location, storage, when it turns off</span>
            <Icon name="caret-down" :size="14" class="muted caret" />
          </summary>
          <div class="three">
            <div class="fieldset">
              <label for="pod-name">Name</label>
              <input id="pod-name" class="field" :value="name ?? autoName" spellcheck="false" @input="name = ($event.target as HTMLInputElement).value" />
              <span class="small muted">Shown in the sidebar. You can rename it later.</span>
            </div>
            <div class="fieldset">
              <span id="cloud-l" class="label-text">Cloud</span>
              <div class="seg wide" role="group" aria-labelledby="cloud-l">
                <button type="button" :aria-pressed="cloud === 'SECURE'" @click="cloud = 'SECURE'">Secure</button>
                <button type="button" :aria-pressed="cloud === 'COMMUNITY'" @click="cloud = 'COMMUNITY'">Community</button>
              </div>
              <span class="small muted">{{ cloud === "SECURE" ? "RunPod's own data centers. More reliable." : "GPUs rented from individual hosts. Cheaper, less reliable." }}</span>
            </div>
            <div class="fieldset">
              <span class="label-text">Location</span>
              <select v-if="cloud === 'SECURE' && regions.length" v-model="location" class="field" aria-label="Location">
                <option value="">Any location</option>
                <optgroup v-for="[region, list] in regions" :key="region" :label="placeName(region, dcs)">
                  <option :value="region">Anywhere in {{ placeName(region, dcs) }}</option>
                  <option v-for="d in list" :key="d.id" :value="d.id">{{ placeName(d.id, dcs) }}</option>
                </optgroup>
              </select>
              <span v-else class="small muted">{{ cloud === "COMMUNITY" ? "Community hosts don't share their location." : "Any location" }}</span>
            </div>
            <div class="fieldset">
              <label for="disk">Storage (GB)</label>
              <input id="disk" type="number" class="field" :min="recDisk" step="5" :value="disk ?? recDisk" @change="setDisk" />
              <span class="small muted">Recommended {{ recDisk }} GB: {{ Math.ceil(weightsGb(model.params)) }} GB of model files plus {{ recDisk - Math.ceil(weightsGb(model.params)) }} GB to download and run them.</span>
            </div>
            <div class="fieldset">
              <label for="idle">Turns off after</label>
              <select id="idle" v-model.number="idleMin" class="field">
                <option v-for="n in IDLE_CHOICES" :key="n" :value="n">{{ n }} quiet min</option>
                <option :value="0">Never</option>
              </select>
              <span class="small muted">Even if you close Hose.</span>
            </div>
            <div class="fieldset">
              <label for="budget">Turn off after spending ($)</label>
              <input
                id="budget"
                type="number"
                class="field"
                min="0"
                step="1"
                placeholder="No limit"
                :value="budget ?? ''"
                @change="budget = Number(($event.target as HTMLInputElement).value) || null"
              />
              <span class="small muted">{{ budget && gpu ? `≈ ${(budget / gpu.price).toFixed(1)} h on ${gpu.name}, each time it's on` : "Each time it's on." }}</span>
            </div>
            <p v-if="allDayCost" class="warn small span">
              Stays on 24/7 until you turn it off: ≈ {{ usd(allDayCost.day) }}/day · ≈ {{ usd(allDayCost.month, 0) }}/month.
            </p>
          </div>
        </details>
      </template>
    </div>

    <footer v-if="advanced" class="foot">
      <span v-if="error" class="grow error" role="alert">{{ error }}</span>
      <span v-else class="grow muted">
        {{ cloud === "SECURE" ? `You pay for the GPU only while it's on. Keeping the model ready costs ≈ ${usd(volumePerMo(disk ?? recDisk))}/mo until you remove it.` : "You pay only while it's on." }}
      </span>
      <button class="btn big" type="button" :disabled="!gpu || !!busy" @click="save(false)">Save only</button>
      <button class="btn primary big" type="button" :disabled="!gpu || !!busy" @click="save(true)">
        {{ busy === "on" ? "Turning on…" : allDayCost ? `Turn on 24/7 · ${gpu!.name} · ≈ ${usd(allDayCost.month, 0)}/mo` : gpu ? `Turn on · ${gpu.name} · $${gpu.price.toFixed(2)}/hr` : "Turn on" }}
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
  gap: 10px;
  padding: 0 22px;
  border-bottom: 1px solid var(--line);
}
.bar h1 {
  font-size: 14.5px;
}
.back {
  padding: 0 8px;
  margin-left: -8px;
}
.flip {
  transform: scaleX(-1);
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
  max-width: 980px;
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
.fill {
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
.search,
.fieldset {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.search label,
.fieldset label,
.label-text {
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
.filters {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.filters .field {
  width: auto;
  min-width: 0;
}
.toggle {
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: var(--surface);
  color: var(--muted);
  cursor: pointer;
  transition:
    background var(--dur) var(--ease-out),
    color var(--dur) var(--ease-out),
    border-color var(--dur) var(--ease-out);
}
.toggle[aria-pressed="true"] {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: var(--accent);
}
.results {
  border: 1px solid var(--line);
  border-radius: 10px;
  overflow: hidden;
}
.cols {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 84px 60px 72px 92px 170px;
  align-items: center;
  gap: 10px;
}
.results-head {
  padding: 7px 12px;
  font-size: 11px;
  color: var(--muted);
  background: var(--paper);
}
.result {
  font: inherit;
  font-size: 11.5px;
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  text-align: left;
  padding: 10px 12px;
  border: 0;
  border-top: 1px solid var(--line);
  background: transparent;
  color: var(--ink);
  cursor: pointer;
  transition: background var(--dur) var(--ease-out);
}
.result.cols {
  display: grid;
}
.result:hover {
  background: var(--hover);
}
.result[aria-pressed="true"] {
  background: var(--accent-soft);
}
.res {
  animation: rise 220ms var(--ease-out) both;
}
.result .id {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  font-weight: 500;
}
.ellipsis {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.result .money {
  font-size: 12px;
}
.pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 20px;
  padding: 0 8px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 500;
  background: var(--accent-soft);
  color: var(--accent);
  white-space: nowrap;
  justify-self: start;
}
.pill.dim {
  background: var(--hover);
  color: var(--muted);
}
.fit {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}
.none {
  padding: 14px 12px;
  border-top: 1px solid var(--line);
  font-size: 12px;
}
/* block, not the panel's flex: WebKit's <details> is no reliable flex container */
.more {
  display: block;
}
.more .three {
  margin-top: 14px;
}
.more > summary {
  list-style: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 10px;
}
.more > summary::-webkit-details-marker {
  display: none;
}
.more > summary .pop {
  font-size: 14px;
}
.caret {
  transition: transform var(--dur) var(--ease-out);
}
.more[open] .caret {
  transform: rotate(180deg);
}
.seg.wide {
  display: flex;
}
.seg.wide button {
  flex: 1;
}
.small {
  font-size: 11px;
}
.three {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr);
  gap: 12px;
}
.span {
  grid-column: 1 / -1;
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
