<script setup lang="ts">
import { ref } from "vue";
import { getBalance, hfWhoami } from "../api";
import { saveKeys, type Keys } from "../secrets";

const props = defineProps<{ keys: Keys }>();
const emit = defineEmits<{ saved: [Keys]; cancel: [] }>();

const runpodKey = ref(props.keys.runpod);
const hfToken = ref(props.keys.hf);
const error = ref("");
const saving = ref(false);

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
  <section class="setup">
    <h1>Connect your accounts</h1>
    <p class="muted">
      Hose rents GPUs on your RunPod account and downloads models from Hugging Face. Your keys stay in this Mac's Keychain.
    </p>
    <form class="panel" @submit.prevent="save">
      <div class="field">
        <label for="runpod-key">RunPod API key</label>
        <small id="runpod-key-hint">On runpod.io, open Settings, then API Keys, and create a key with read and write access.</small>
        <input id="runpod-key" v-model="runpodKey" class="secret" aria-describedby="runpod-key-hint" autocomplete="off" spellcheck="false" required />
      </div>
      <div class="field">
        <label for="hf-token">Hugging Face token</label>
        <small id="hf-token-hint">Optional. Only needed for gated models such as Llama. Create one at huggingface.co/settings/tokens.</small>
        <input id="hf-token" v-model="hfToken" class="secret" aria-describedby="hf-token-hint" autocomplete="off" spellcheck="false" />
      </div>
      <p v-if="error" class="error" role="alert">{{ error }}. Check the key and try again.</p>
      <div class="actions">
        <button class="primary" :disabled="saving || !runpodKey.trim()">{{ saving ? "Checking…" : "Save" }}</button>
        <button v-if="keys.runpod" type="button" class="quiet" @click="emit('cancel')">Back</button>
      </div>
    </form>
  </section>
</template>

<style scoped>
.setup {
  display: grid;
  gap: 0.9rem;
  max-width: 560px;
}
form {
  display: grid;
  gap: 1.1rem;
  padding: 1.25rem;
}
/* ponytail: text input + masking instead of type=password, so it stays an accessible textbox and password managers leave it alone */
.secret {
  -webkit-text-security: disc;
}
.actions {
  display: flex;
  gap: 0.5rem;
}
</style>
