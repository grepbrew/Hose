<script setup lang="ts">
import { ref, computed } from "vue";
import { createEndpoint, deleteEndpoint, hfModelInfo, hfCanDownload, type Endpoint } from "../api";
import { PRESETS, pickPools, vramNeededGb, parseHfModel, endpointInput, gpuState, type Model } from "../cost";
import type { Fleet } from "../fleet";

const props = defineProps<{ apiKey: string; hfToken: string; fleet: Fleet }>();
const emit = defineEmits<{ chat: [Endpoint] }>();

const fit = (m: Model) => {
  if (!props.fleet.s.gpus.length) return null;
  try {
    const need = vramNeededGb(m.params);
    const pick = pickPools(props.fleet.s.gpus, need);
    const gb = Math.min(...props.fleet.s.gpus.filter((g) => pick.pools.includes(g.pool ?? "")).map((g) => g.memory));
    return { ...pick, gb };
  } catch {
    return null;
  }
};
const range = (p: { from: number; to: number }) =>
  p.from === p.to ? `$${p.from.toFixed(2)}/hr` : `$${p.from.toFixed(2)}–$${p.to.toFixed(2)}/hr`;
const presets = computed(() => PRESETS.map((p) => ({ ...p, fit: fit(p) })));

const busy = ref("");
const error = ref("");
async function deploy(m: Model) {
  const f = fit(m);
  if (!f) return;
  busy.value = m.id;
  error.value = "";
  try {
    await createEndpoint(props.apiKey, endpointInput(m, f.pools, props.hfToken));
    await props.fleet.refresh();
    checked.value = null;
  } catch (e) {
    error.value = `Couldn't deploy ${m.id}: ${e instanceof Error ? e.message : e}`;
  } finally {
    busy.value = "";
  }
}

const hfId = ref("");
const checking = ref(false);
const checkError = ref("");
const checked = ref<Model | null>(null);
const checkedFit = computed(() => checked.value && fit(checked.value));
async function check() {
  checkError.value = "";
  checked.value = null;
  checking.value = true;
  const id = hfId.value.trim().replace(/^https:\/\/huggingface\.co\//, "");
  try {
    const info = await hfModelInfo(id, props.hfToken);
    const r = parseHfModel(info, !!props.hfToken);
    if (!r.ok) {
      checkError.value =
        r.reason === "needs Hugging Face token"
          ? "This model is gated. Add a Hugging Face token under Keys first."
          : `${id} is ${r.reason}. Hose v1 runs text chat models only.`;
      return;
    }
    if (info.gated && !(await hfCanDownload(id, props.hfToken))) {
      checkError.value = `Accept the licence on huggingface.co/${id} with your Hugging Face account, then check again.`;
      return;
    }
    if (!props.fleet.s.gpus.length) {
      checkError.value = "Couldn't load GPU prices from RunPod yet. Try again in a moment.";
      return;
    }
    if (!fit(r.model)) {
      checkError.value = `${id} is too big for one GPU (needs about ${Math.ceil(vramNeededGb(r.model.params))} GB).`;
      return;
    }
    checked.value = r.model;
  } catch (e) {
    checkError.value = e instanceof Error ? e.message : String(e);
  } finally {
    checking.value = false;
  }
}

async function remove(ep: Endpoint) {
  busy.value = ep.id;
  try {
    await deleteEndpoint(props.apiKey, ep.id);
    await props.fleet.refresh();
  } catch (e) {
    error.value = `Couldn't remove: ${e instanceof Error ? e.message : e}`;
  } finally {
    busy.value = "";
  }
}

const label = (ep: Endpoint) => ep.name.replace(/^hose-/, "").replace(/\s*-fb$/, "");
</script>

<template>
  <section class="stack">
    <h1>Pick a model</h1>
    <p class="muted">
      You only pay while a model is awake. It wakes up when you send a message and goes back to sleep a minute after the last reply.
    </p>
    <ul class="panel rows">
      <li v-for="p in presets" :key="p.id">
        <div class="grow">
          <h3>{{ p.label }}</h3>
          <p>{{ p.blurb }}</p>
          <p class="muted small">{{ p.id }}</p>
        </div>
        <p class="price" v-if="p.fit">
          <strong>{{ range(p.fit.price) }}</strong>
          <span class="muted small">while awake, {{ p.fit.gb }} GB GPU</span>
        </p>
        <button class="primary" :disabled="!p.fit || !!busy" @click="deploy(p)">{{ busy === p.id ? "Deploying…" : "Deploy" }}</button>
      </li>
    </ul>

    <form class="advanced" @submit.prevent="check">
      <div class="field grow">
        <label for="hf-model">Hugging Face model</label>
        <small id="hf-model-hint">Or paste any text chat model, for example mistralai/Mistral-7B-Instruct-v0.3</small>
        <input id="hf-model" v-model="hfId" aria-describedby="hf-model-hint" spellcheck="false" placeholder="owner/model-name" />
      </div>
      <button :disabled="checking || !hfId.trim()">{{ checking ? "Checking…" : "Check" }}</button>
    </form>
    <p v-if="checkError" class="error" role="alert">{{ checkError }}</p>
    <div v-if="checked && checkedFit" class="panel rows">
      <div class="row">
        <div class="grow">
          <h3>{{ checked.id }}</h3>
          <p class="muted">Fits a {{ checkedFit.gb }} GB GPU, {{ range(checkedFit.price) }} while awake.</p>
        </div>
        <button class="primary" :disabled="!!busy" @click="deploy(checked)">{{ busy === checked.id ? "Deploying…" : "Deploy" }}</button>
      </div>
    </div>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
  </section>

  <section class="stack">
    <h2>Your models</h2>
    <p v-if="!fleet.s.endpoints.length" class="muted">No models yet. Deploy one above and it shows up here.</p>
    <ul v-else class="panel rows">
      <li v-for="ep in fleet.s.endpoints" :key="ep.id">
        <div class="grow">
          <h3>{{ label(ep) }}</h3>
          <p>
            <span class="state" :data-state="gpuState(fleet.s.workers[ep.id] ?? [])">{{ gpuState(fleet.s.workers[ep.id] ?? []) }}</span>
            <span class="muted small" title="RunPod billing updates about every 5 minutes">
              Today ${{ (fleet.s.costToday[ep.id] ?? 0).toFixed(2) }}
            </span>
          </p>
        </div>
        <button class="primary" @click="emit('chat', ep)">Chat</button>
        <button class="quiet" :disabled="busy === ep.id" @click="remove(ep)">{{ busy === ep.id ? "Removing…" : "Remove" }}</button>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.stack {
  display: grid;
  gap: 0.8rem;
}
.rows {
  list-style: none;
  margin: 0;
  padding: 0;
}
.rows > li,
.row {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem 1.25rem;
}
.rows > li + li {
  border-top: 1px solid var(--line);
}
.grow {
  flex: 1;
  min-width: 0;
}
.small {
  font-size: 0.85rem;
}
.price {
  display: grid;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.advanced {
  display: flex;
  align-items: end;
  gap: 0.5rem;
}
.state {
  font-weight: 600;
  margin-right: 0.75rem;
}
.state::before {
  content: "";
  display: inline-block;
  width: 0.55rem;
  height: 0.55rem;
  border-radius: 50%;
  margin-right: 0.4rem;
  background: var(--line);
}
.state:not([data-state="Asleep"])::before {
  background: var(--hose);
}
.state[data-state="Waking up"]::before {
  background: var(--brass);
}
@media (max-width: 640px) {
  .rows > li,
  .row {
    flex-wrap: wrap;
  }
}
</style>
