<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { getGpus } from "../api";
import { gpuCards, vramNeededGb, label, type Cloud, type Gpu, type GpuCard, type Model } from "../cost";

// The GPU section of New pod and of Change GPU. The parent puts its step badge and title in the slot.
const props = defineProps<{ apiKey: string; model: Model; cloud: Cloud; picked?: string }>();
const emit = defineEmits<{ "update:cloud": [Cloud]; pick: [GpuCard] }>();

const all = ref(false);
const catalog = ref<Gpu[]>([]);
const loading = ref(false);
const error = ref("");

const need = computed(() => vramNeededGb(props.model.params));
const cards = computed(() => gpuCards(catalog.value, props.cloud, need.value));
const shown = computed(() => (all.value ? cards.value : cards.value.filter((c) => c.fits)));

async function load() {
  loading.value = true;
  error.value = "";
  try {
    catalog.value = await getGpus(props.apiKey, props.cloud);
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    loading.value = false;
  }
}
watch(() => props.cloud, load, { immediate: true });
// Always have a GPU picked: the cheapest that fits, unless the current pick still fits.
watch([cards, () => props.picked], () => {
  const fits = cards.value.filter((c) => c.fits);
  const current = fits.find((c) => c.id === props.picked);
  if (current) emit("pick", current); // refresh its price after a cloud switch
  else if (fits[0]) emit("pick", fits[0]);
});

const STOCK: Record<string, [number, string]> = { HIGH: [3, "Plenty free"], MEDIUM: [2, "Some free"], LOW: [1, "Few free"], NONE: [0, "None free"] };
</script>

<template>
  <div class="head">
    <slot />
    <span class="need muted">{{ label(model.id) }} needs about {{ Math.ceil(need) }} GB of GPU memory</span>
    <div class="seg" role="group" aria-label="Cloud">
      <button type="button" :aria-pressed="cloud === 'SECURE'" @click="emit('update:cloud', 'SECURE')">Secure</button>
      <button type="button" :aria-pressed="cloud === 'COMMUNITY'" @click="emit('update:cloud', 'COMMUNITY')">Community</button>
    </div>
  </div>
  <p class="hint muted">{{ cloud === "SECURE" ? "RunPod's own data centers. More reliable." : "GPUs rented from individual hosts. Cheaper, less reliable." }}</p>

  <p v-if="loading && !catalog.length" class="muted small">Loading GPU prices…</p>
  <p v-else-if="error" class="error small" role="alert">
    Couldn't load GPU prices: {{ error }}
    <button type="button" class="link" @click="load">Try again</button>
  </p>
  <p v-else-if="!shown.length" class="muted small">No GPU on this cloud can run this model right now. Try the other cloud.</p>
  <ul v-else class="grid">
    <li v-for="c in shown" :key="c.id">
      <button type="button" class="pick" :aria-pressed="picked === c.id" :disabled="!c.fits" @click="emit('pick', c)">
        <span class="top">
          <strong>{{ c.name }}</strong>
          <span class="money">${{ c.price.toFixed(2) }}</span>
        </span>
        <span class="muted mem">{{ c.memory }} GB GPU memory</span>
        <span class="stock muted" :title="STOCK[c.stock]?.[1]">
          <span class="bars" aria-hidden="true"><i v-for="i in 3" :key="i" :class="{ on: i <= (STOCK[c.stock]?.[0] ?? 0) }" /></span>
          {{ c.reason || STOCK[c.stock]?.[1] }}
        </span>
      </button>
    </li>
  </ul>
  <p class="muted small">
    {{ all ? "Showing every GPU on this cloud." : "Only GPUs that fit this model are shown." }}
    <button type="button" class="link" @click="all = !all">{{ all ? "Only ones that fit" : "Show all" }}</button>
  </p>
</template>

<style scoped>
.head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.need {
  font-size: 12px;
  flex-grow: 1;
}
.hint {
  margin-top: -6px;
  font-size: 11.5px;
}
.small {
  font-size: 11.5px;
}
.grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 8px;
}
.pick {
  width: 100%;
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
.pick:disabled {
  opacity: 0.5;
  cursor: default;
}
.top {
  display: flex;
  justify-content: space-between;
  gap: 6px;
  font-size: 12.5px;
}
.top strong {
  font-weight: 600;
}
.mem {
  font-size: 11.5px;
}
.stock {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
}
.bars {
  display: inline-flex;
  gap: 3px;
  align-items: center;
}
.bars i {
  display: block;
  width: 12px;
  height: 5px;
  border-radius: 3px;
  background: var(--line);
}
.bars i.on {
  background: var(--accent);
}
</style>
