<script setup lang="ts">
import { ref, onMounted } from "vue";
import { getSecret } from "./secrets";
import { useFleet } from "./fleet";
import type { Endpoint } from "./api";
import CostBar from "./views/CostBar.vue";
import Setup from "./views/Setup.vue";
import Models from "./views/Models.vue";
import Chat from "./views/Chat.vue";

const view = ref<"loading" | "setup" | "models" | "chat">("loading");
const key = ref("");
const hfToken = ref("");
const chatWith = ref<Endpoint | null>(null);
const fleet = useFleet(() => key.value);

async function loadKeys() {
  key.value = await getSecret("runpod");
  hfToken.value = await getSecret("hf");
  view.value = key.value ? "models" : "setup";
  if (key.value) await fleet.start();
}
onMounted(loadKeys);

function openChat(ep: Endpoint) {
  chatWith.value = ep;
  view.value = "chat";
}
</script>

<template>
  <CostBar v-if="key" :fleet="fleet" @settings="view = 'setup'" />
  <main>
    <Setup v-if="view === 'setup'" :has-key="!!key" @saved="loadKeys" @cancel="view = 'models'" />
    <Models v-else-if="view === 'models'" :api-key="key" :hf-token="hfToken" :fleet="fleet" @chat="openChat" />
    <Chat v-else-if="view === 'chat' && chatWith" :api-key="key" :endpoint="chatWith" :fleet="fleet" @back="view = 'models'" />
  </main>
</template>
