<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useFleet, type Saved } from "./fleet";
import { loadKeys, saveKeys, type Keys } from "./secrets";
import CostBar from "./views/CostBar.vue";
import Setup from "./views/Setup.vue";
import Models from "./views/Models.vue";
import Chat from "./views/Chat.vue";

const view = ref<"loading" | "setup" | "models" | "chat">("loading");
const keys = ref<Keys>({ runpod: "", hf: "", vllm: "" });
const chatWith = ref<Saved | null>(null);
const fleet = useFleet(
  () => keys.value.runpod,
  () => keys.value.vllm,
  () => keys.value.hf,
);

async function use(k: Keys) {
  keys.value = k;
  view.value = k.runpod ? "models" : "setup";
  if (k.runpod) await fleet.start();
}
// The Keychain is read once per launch; Setup gets the keys as props and hands back what it saved.
onMounted(async () => {
  const k = await loadKeys();
  // One random key per Mac guards every pod's public vLLM URL; only Hose and the pod know it.
  if (!k.vllm) {
    k.vllm = crypto.randomUUID();
    await saveKeys(k);
  }
  await use(k);
});

function openChat(m: Saved) {
  chatWith.value = m;
  view.value = "chat";
}
</script>

<template>
  <CostBar v-if="keys.runpod" :fleet="fleet" @settings="view = 'setup'" />
  <main>
    <Setup v-if="view === 'setup'" :keys="keys" @saved="use" @cancel="view = 'models'" />
    <Models v-else-if="view === 'models'" :api-key="keys.runpod" :hf-token="keys.hf" :fleet="fleet" @chat="openChat" />
    <Chat v-else-if="view === 'chat' && chatWith" :vllm-key="keys.vllm" :model="chatWith" :fleet="fleet" @back="view = 'models'" />
  </main>
</template>
