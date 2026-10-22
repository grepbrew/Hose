<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { getGpus } from "../api";
import { gpuCards, vramNeededGb, type Cloud, type Gpu, type Model } from "../cost";

const props = defineProps<{ apiKey: string; model: Model; action: string }>();
const emit = defineEmits<{ pick: [{ gpuId: string; gpuName: string; cloud: Cloud }]; cancel: [] }>();

const cloud = ref<Cloud>("SECURE");
const tab = ref<"fits" | "all">("fits");
const catalog = ref<Gpu[]>([]);
const loading = ref(false);
const error = ref("");
const picked = ref("");

const need = computed(() => vramNeededGb(props.model.params));
const cards = computed(() => gpuCards(catalog.value, cloud.value, need.value));
const shown = computed(() => (tab.value === "fits" ? cards.value.filter((c) => c.fits) : cards.value));
const choice = computed(() => cards.value.find((c) => c.id === picked.value && c.fits));

async function load() {
  loading.value = true;
  error.value = "";
  try {
    catalog.value = await getGpus(props.apiKey, cloud.value);
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    loading.value = false;
  }
}
watch(cloud, load, { immediate: true });

const STOCK: Record<string, [number, string]> = { HIGH: [3, "Plenty free"], MEDIUM: [2, "Some free"], LOW: [1, "Few free"], NONE: [0, "None free"] };
const price = (n: number) => `$${n.toFixed(2)}/hr`;
</script>

<template>
  <section class="picker">
    <header>
      <h1>Choose a GPU for {{ model.id }}</h1>
      <p class="muted">Needs about {{ Math.ceil(need) }} GB of GPU memory. You pay the hourly price only while it's on.</p>
    </header>

    <div class="controls">
      <div class="segmented" role="group" aria-label="Cloud">
        <button :aria-pressed="cloud === 'SECURE'" @click="cloud = 'SECURE'">Secure</button>
        <button :aria-pressed="cloud === 'COMMUNITY'" @click="cloud = 'COMMUNITY'">Community</button>
      </div>
      <p class="muted small">
        {{ cloud === "SECURE" ? "RunPod's own data centers. More reliable." : "GPUs rented from individual hosts. Cheaper, less reliable." }}
      </p>
      <div class="segmented tabs" role="group" aria-label="Show">
        <button :aria-pressed="tab === 'fits'" @click="tab = 'fits'">Fits this model</button>
        <button :aria-pressed="tab === 'all'" @click="tab = 'all'">All</button>
      </div>
    </div>

    <p v-if="loading" class="muted">Loading GPU prices…</p>
    <p v-else-if="error" class="error" role="alert">
      Couldn't load GPU prices: {{ error }}
      <button @click="load">Try again</button>
    </p>
    <p v-else-if="!shown.length" class="muted">No GPU on this cloud can run this model right now. Try the other cloud.</p>
    <ul v-else class="grid">
      <li v-for="c in shown" :key="c.id">
        <button class="card" :aria-pressed="picked === c.id" :disabled="!c.fits" @click="picked = c.id">
          <span class="top">
            <strong>{{ c.name }}</strong>
            <span class="price">{{ price(c.price) }}</span>
          </span>
          <span class="muted">{{ c.memory }} GB GPU memory</span>
          <span class="stock" :title="STOCK[c.stock]?.[1]">
            <span v-for="i in 3" :key="i" class="bar" :class="{ on: i <= (STOCK[c.stock]?.[0] ?? 0) }" aria-hidden="true" />
            <span class="small">{{ c.reason || STOCK[c.stock]?.[1] }}</span>
          </span>
        </button>
      </li>
    </ul>

    <div class="actions">
      <button class="primary" :disabled="!choice" @click="choice && emit('pick', { gpuId: choice.id, gpuName: choice.name, cloud })">
        {{ choice ? `${action} ${choice.name} · ${price(choice.price)} while on` : "Pick a GPU above" }}
      </button>
      <button class="quiet" @click="emit('cancel')">Cancel</button>
    </div>
  </section>
</template>

<style scoped>
.picker {
  display: grid;
  gap: 1rem;
}
header {
  display: grid;
  gap: 0.35rem;
}
.controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem 1rem;
}
.tabs {
  margin-left: auto;
}
.segmented {
  display: inline-flex;
  border: 1px solid var(--line);
  border-radius: var(--radius-control);
  overflow: hidden;
}
.segmented button {
  border: none;
  border-radius: 0;
  background: transparent;
  color: var(--muted);
}
.segmented button[aria-pressed="true"] {
  background: var(--hose);
  color: var(--surface);
}
.small {
  font-size: 0.85rem;
}
.grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 0.75rem;
}
.card {
  width: 100%;
  display: grid;
  gap: 0.35rem;
  text-align: left;
  font-weight: 400;
  padding: 0.85rem 1rem;
  border-radius: var(--radius-panel);
}
.card[aria-pressed="true"] {
  border-color: var(--hose);
  box-shadow: inset 0 0 0 1px var(--hose);
  background: var(--hose-soft);
}
.top {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
}
.price {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}
.stock {
  display: flex;
  align-items: center;
  gap: 3px;
  color: var(--muted);
}
.bar {
  width: 14px;
  height: 6px;
  border-radius: 3px;
  background: var(--line);
}
.bar.on {
  background: var(--hose);
}
.stock .small {
  margin-left: 0.4rem;
}
.actions {
  position: sticky;
  bottom: 1rem;
  display: flex;
  gap: 0.5rem;
}
</style>
