<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useFleet, type Saved } from "./fleet";
import { getSecret, setSecret } from "./secrets";
import CostBar from "./views/CostBar.vue";
import Setup from "./views/Setup.vue";
import Models from "./views/Models.vue";
import Chat from "./views/Chat.vue";

const view = ref<"loading" | "setup" | "models" | "chat">("loading");
const key = ref("");
const hfToken = ref("");
const vllmKey = ref("");
const chatWith = ref<Saved | null>(null);
const fleet = useFleet(
  () => key.value,
  () => vllmKey.value,
  () => hfToken.value,
);

async function loadKeys() {
  key.value = await getSecret("runpod");
  hfToken.value = await getSecret("hf");
  // One random key per Mac guards every pod's public vLLM URL; only Hose and the pod know it.
  vllmKey.value = await getSecret("vllm");
  if (!vllmKey.value) await setSecret("vllm", (vllmKey.value = crypto.randomUUID()));
  view.value = key.value ? "models" : "setup";
  if (key.value) await fleet.start();
}
onMounted(loadKeys);

function openChat(m: Saved) {
  chatWith.value = m;
  view.value = "chat";
}
</script>

<template>
  <CostBar v-if="key" :fleet="fleet" @settings="view = 'setup'" />
  <main>
    <Setup v-if="view === 'setup'" :has-key="!!key" @saved="loadKeys" @cancel="view = 'models'" />
    <Models v-else-if="view === 'models'" :api-key="key" :hf-token="hfToken" :fleet="fleet" @chat="openChat" />
    <Chat v-else-if="view === 'chat' && chatWith" :vllm-key="vllmKey" :model="chatWith" :fleet="fleet" @back="view = 'models'" />
  </main>
</template>
