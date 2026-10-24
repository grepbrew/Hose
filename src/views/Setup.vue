<script setup lang="ts">
import { ref } from "vue";
import { getBalance, hfWhoami } from "../api";
import { saveKeys, type Keys } from "../secrets";

// First run: a full-screen card with no sidebar. `embedded`: the same form as Settings › Keys inside the content area.
const props = defineProps<{ keys: Keys; embedded?: boolean }>();
const emit = defineEmits<{ saved: [Keys]; cancel: [] }>();

const runpodKey = ref(props.keys.runpod);
const hfToken = ref(props.keys.hf);
const error = ref("");
const saving = ref(false);
const showKey = ref(false);
const showHf = ref(false);

async function save() {
  error.value = "";
  saving.value = true;
  try {
    await getBalance(runpodKey.value.trim());
    if (hfToken.value.trim()) await hfWhoami(hfToken.value.trim());
    const next = { ...props.keys, runpod: runpodKey.value.trim(), hf: hfToken.value.trim() };
    await saveKeys(next);
    emit("saved", next);
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <section v-if="embedded" class="page-col">
    <header class="bar" data-tauri-drag-region>
      <h1><span class="muted crumb">Settings ›</span> Keys</h1>
    </header>
    <div class="scroll">
      <form class="panel" @submit.prevent="save">
        <p class="muted intro">Hose rents GPUs on your RunPod account and downloads models from Hugging Face. Your keys stay on this Mac.</p>
        <div class="fieldset">
          <label for="runpod-key">RunPod API key</label>
          <span id="runpod-key-hint" class="hint">On runpod.io, open Settings, then API Keys, and create a key with read and write access.</span>
          <div class="reveal">
            <input id="runpod-key" v-model="runpodKey" :class="['field', { secret: !showKey }]" aria-describedby="runpod-key-hint" autocomplete="off" spellcheck="false" required />
            <button type="button" class="btn quiet" :aria-label="`${showKey ? 'Hide' : 'Show'} RunPod API key`" @click="showKey = !showKey">{{ showKey ? "Hide" : "Show" }}</button>
          </div>
        </div>
        <div class="fieldset">
          <label for="hf-token">Hugging Face token</label>
          <span id="hf-token-hint" class="hint">Optional. Only needed for gated models such as Llama. Create one at huggingface.co/settings/tokens.</span>
          <div class="reveal">
            <input id="hf-token" v-model="hfToken" :class="['field', { secret: !showHf }]" aria-describedby="hf-token-hint" autocomplete="off" spellcheck="false" />
            <button type="button" class="btn quiet" :aria-label="`${showHf ? 'Hide' : 'Show'} Hugging Face token`" @click="showHf = !showHf">{{ showHf ? "Hide" : "Show" }}</button>
          </div>
        </div>
        <p v-if="error" class="error" role="alert">{{ error }}. Check the key and try again.</p>
        <div class="actions">
          <button class="btn primary" :disabled="saving || !runpodKey.trim()">{{ saving ? "Checking…" : "Save" }}</button>
          <button type="button" class="btn quiet" @click="emit('cancel')">Cancel</button>
        </div>
      </form>
    </div>
  </section>

  <div v-else class="first">
    <div class="drag" data-tauri-drag-region />
    <form class="card-in" @submit.prevent="save">
      <div class="brand"><span class="pop">Hose</span><i /></div>
      <div class="lead">
        <h1>Connect your accounts</h1>
        <p class="muted">Hose rents GPUs on your RunPod account and downloads models from Hugging Face. Your keys stay on this Mac.</p>
      </div>
      <div class="fieldset">
        <label for="runpod-key">RunPod API key</label>
        <span id="runpod-key-hint" class="hint">On runpod.io, open Settings, then API Keys, and create a key with read and write access.</span>
        <div class="reveal">
          <input id="runpod-key" v-model="runpodKey" :class="['field', { secret: !showKey }]" aria-describedby="runpod-key-hint" autocomplete="off" spellcheck="false" required />
          <button type="button" class="btn quiet" :aria-label="`${showKey ? 'Hide' : 'Show'} RunPod API key`" @click="showKey = !showKey">{{ showKey ? "Hide" : "Show" }}</button>
        </div>
      </div>
      <div class="fieldset">
        <label for="hf-token">Hugging Face token <span class="opt">(optional)</span></label>
        <span id="hf-token-hint" class="hint">Only needed for gated models such as Llama.</span>
        <div class="reveal">
          <input id="hf-token" v-model="hfToken" :class="['field', { secret: !showHf }]" aria-describedby="hf-token-hint" autocomplete="off" spellcheck="false" />
          <button type="button" class="btn quiet" :aria-label="`${showHf ? 'Hide' : 'Show'} Hugging Face token`" @click="showHf = !showHf">{{ showHf ? "Hide" : "Show" }}</button>
        </div>
      </div>
      <p v-if="error" class="error" role="alert">{{ error }}. Check the key and try again.</p>
      <button class="btn primary big wide" :disabled="saving || !runpodKey.trim()">{{ saving ? "Checking…" : "Save and continue" }}</button>
    </form>
  </div>
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
.crumb {
  font-weight: 500;
}
.scroll {
  flex-grow: 1;
  overflow: auto;
  padding: 28px;
}
.panel {
  max-width: 520px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 22px 24px;
}
.intro,
.lead p {
  font-size: 12.5px;
  line-height: 1.5;
}
.fieldset {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.fieldset label {
  font-size: 12.5px;
  font-weight: 600;
}
.reveal {
  display: flex;
  align-items: center;
  gap: 6px;
}
.reveal .field {
  flex: 1;
  min-width: 0;
}
.reveal .btn {
  width: 60px; /* Show and Hide differ in width; keep the field still */
}
.hint {
  font-size: 11.5px;
  color: var(--muted);
}
.opt {
  font-weight: 400;
  color: var(--muted);
}
.actions {
  display: flex;
  gap: 8px;
}
.first {
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}
.drag {
  position: absolute;
  inset: 0 0 auto;
  height: 52px;
}
.card-in {
  width: 440px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 18px;
  padding: 32px 32px 28px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.06);
  animation: rise 320ms var(--ease-out) both;
}
.card-in .field {
  height: 38px;
}
.brand {
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.brand span {
  font-size: 20px;
  letter-spacing: -0.01em;
}
.brand i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--accent);
}
.lead {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.lead h1 {
  font-size: 19px;
}
.wide {
  width: 100%;
}
</style>
