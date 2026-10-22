<script setup lang="ts">
import { ref } from "vue";
import { hfModelInfo, hfCanDownload } from "../api";
import { PRESETS, parseHfModel, type Cloud, type Model } from "../cost";
import type { Fleet, Saved } from "../fleet";
import GpuPicker from "./GpuPicker.vue";

const props = defineProps<{ apiKey: string; hfToken: string; fleet: Fleet }>();
const emit = defineEmits<{ chat: [Saved] }>();

const IDLE_CHOICES = [2, 5, 10, 20, 30, 60];
const label = (id: string) => id.split("/").pop()!;
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

// The picker serves both a new model (Turn on) and an Off model moving to another GPU (Change GPU).
const picking = ref<{ model: Model; saved?: Saved } | null>(null);
const busy = ref("");
const error = ref("");

async function picked(p: { gpuId: string; gpuName: string; cloud: Cloud }) {
  const { model, saved } = picking.value!;
  picking.value = null;
  if (!saved && props.fleet.s.models.some((x) => x.id === model.id && x.podId)) {
    error.value = `${label(model.id)} is already on. Turn it off first to move it to another GPU.`;
    return;
  }
  const m: Saved = { id: model.id, params: model.params, idleMin: saved?.idleMin ?? 10, ...p };
  props.fleet.save(m);
  if (!saved) await turnOn(props.fleet.s.models.at(-1)!);
}

async function run(m: Saved, fn: () => Promise<unknown>, what: string) {
  busy.value = m.id;
  error.value = "";
  try {
    await fn();
  } catch (e) {
    error.value = `Couldn't ${what} ${label(m.id)}: ${errorText(e)}`;
  } finally {
    busy.value = "";
  }
}
const turnOn = (m: Saved) => run(m, () => props.fleet.turnOn(m), "turn on");
const turnOff = (m: Saved) => run(m, () => props.fleet.turnOff(m), "turn off");
const forget = (m: Saved) => run(m, () => props.fleet.forget(m), "forget");

const hfId = ref("");
const checking = ref(false);
const checkError = ref("");
async function check() {
  checkError.value = "";
  checking.value = true;
  const id = hfId.value.trim().replace(/^https:\/\/huggingface\.co\//, "");
  try {
    const info = await hfModelInfo(id, props.hfToken);
    const r = parseHfModel(info, !!props.hfToken);
    if (!r.ok) {
      checkError.value =
        r.reason === "needs Hugging Face token"
          ? "This model is gated. Add a Hugging Face token under Keys first."
          : `${id} is ${r.reason}. Hose runs text chat models only.`;
      return;
    }
    if (info.gated && !(await hfCanDownload(id, props.hfToken))) {
      checkError.value = `Accept the licence on huggingface.co/${id} with your Hugging Face account, then check again.`;
      return;
    }
    picking.value = { model: r.model };
  } catch (e) {
    checkError.value = errorText(e);
  } finally {
    checking.value = false;
  }
}
</script>

<template>
  <GpuPicker
    v-if="picking"
    :api-key="apiKey"
    :model="picking.model"
    :action="picking.saved ? 'Use' : 'Turn on'"
    @pick="picked"
    @cancel="picking = null"
  />

  <template v-else>
    <section class="stack">
      <h1>Pick a model</h1>
      <p class="muted">
        You choose the GPU. It runs while it's on and turns itself off after a few quiet minutes, even if you close Hose.
      </p>
      <ul class="panel rows">
        <li v-for="p in PRESETS" :key="p.id">
          <div class="grow">
            <h3>{{ p.label }}</h3>
            <p>{{ p.blurb }}</p>
            <p class="muted small">{{ p.id }}</p>
          </div>
          <button class="primary" @click="picking = { model: p }">Choose GPU</button>
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
    </section>

    <section class="stack">
      <h2>Your models</h2>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <p v-if="!fleet.s.models.length && !fleet.strays.value.length" class="muted">
        No models yet. Choose a GPU for one above and it shows up here.
      </p>
      <ul v-else class="panel rows">
        <li v-for="m in fleet.s.models" :key="m.id">
          <div class="grow">
            <h3>{{ label(m.id) }}</h3>
            <p>
              <span class="state" :data-state="fleet.state(m)">{{ fleet.state(m) }}</span>
              <span class="muted small">
                <template v-if="fleet.state(m) === 'Starting'">downloading and loading the model, 2–5 min · </template>
                <template v-else-if="fleet.state(m) === 'On'">turns off in {{ fleet.offInMin(m) }} min · </template>
                {{ m.gpuName }}, {{ m.cloud === "SECURE" ? "Secure" : "Community" }}
              </span>
            </p>
            <label class="idle small muted">
              Turns off after
              <select v-model.number="m.idleMin" :disabled="!!m.podId">
                <option v-for="n in IDLE_CHOICES" :key="n" :value="n">{{ n }} quiet min</option>
              </select>
            </label>
          </div>
          <template v-if="m.podId">
            <button class="primary" :disabled="fleet.state(m) === 'Starting'" @click="emit('chat', m)">Chat</button>
            <button :disabled="busy === m.id" @click="turnOff(m)">{{ busy === m.id ? "Turning off…" : "Turn off" }}</button>
          </template>
          <template v-else>
            <button class="primary" :disabled="busy === m.id" @click="turnOn(m)">{{ busy === m.id ? "Turning on…" : "Turn on" }}</button>
            <button @click="picking = { model: m, saved: m }">Change GPU</button>
            <button class="quiet" :disabled="busy === m.id" @click="forget(m)">Forget</button>
          </template>
        </li>
        <li v-for="p in fleet.strays.value" :key="p.id">
          <div class="grow">
            <h3>{{ p.name.replace(/^hose-/, "") }}</h3>
            <p class="muted small">Running on RunPod, not set up on this Mac · ${{ p.cost.toFixed(2) }}/hr</p>
          </div>
          <button @click="fleet.turnOff({ podId: p.id })">Turn off</button>
        </li>
      </ul>
    </section>
  </template>
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
.rows > li {
  display: flex;
  align-items: center;
  gap: 0.75rem;
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
.advanced {
  display: flex;
  align-items: end;
  gap: 0.5rem;
}
.idle {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-weight: 400;
  margin-top: 0.3rem;
}
.idle select {
  font: inherit;
  color: var(--ink);
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-control);
  padding: 0.1rem 0.3rem;
}
.state {
  font-weight: 600;
  margin-right: 0.5rem;
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
.state[data-state="On"]::before,
.state[data-state="Answering"]::before {
  background: var(--hose);
}
.state[data-state="Starting"]::before {
  background: var(--brass);
}
@media (max-width: 640px) {
  .rows > li {
    flex-wrap: wrap;
  }
}
</style>
