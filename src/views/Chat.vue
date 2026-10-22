<script setup lang="ts">
import { ref, computed, nextTick, onUnmounted } from "vue";
import { startChat, pollStream, type Endpoint, type Message } from "../api";
import { gpuState, streamText } from "../cost";
import type { Fleet } from "../fleet";

const props = defineProps<{ apiKey: string; endpoint: Endpoint; fleet: Fleet }>();
defineEmits<{ back: [] }>();

const messages = ref<Message[]>([]);
const draft = ref("");
const busy = ref(false);
const queued = ref(false);
const error = ref("");
const list = ref<HTMLElement>();
let stopped = false;
onUnmounted(() => (stopped = true));

const state = computed(() => gpuState(props.fleet.s.workers[props.endpoint.id] ?? []));
const DONE = new Set(["COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"]);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const scroll = () => nextTick(() => list.value?.lastElementChild?.scrollIntoView({ block: "end" }));

async function send() {
  const text = draft.value.trim();
  if (!text || busy.value) return;
  draft.value = "";
  error.value = "";
  busy.value = true;
  messages.value.push({ role: "user", content: text });
  const history = messages.value.slice();
  messages.value.push({ role: "assistant", content: "" });
  scroll();
  try {
    const job = await startChat(props.apiKey, props.endpoint.id, history);
    for (;;) {
      if (stopped) return;
      const r = await pollStream(props.apiKey, props.endpoint.id, job);
      queued.value = r.status === "IN_QUEUE";
      messages.value[messages.value.length - 1].content += streamText(r.stream ?? []);
      scroll();
      if (DONE.has(r.status)) {
        if (r.status !== "COMPLETED") error.value = `The model stopped with status ${r.status}. Try sending again.`;
        break;
      }
      await wait(500);
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
    queued.value = false;
    if (!messages.value.at(-1)?.content) messages.value.pop();
  }
}
</script>

<template>
  <section class="chat">
    <header>
      <button class="quiet" @click="$emit('back')">Back to models</button>
      <h1>{{ endpoint.name.replace(/^hose-/, "").replace(/\s*-fb$/, "") }}</h1>
      <p class="muted">GPU: {{ state }}</p>
    </header>

    <ol ref="list" class="messages" aria-live="polite">
      <li v-if="!messages.length" class="muted">Say hello. The first reply after a break takes a minute or two while the GPU wakes up.</li>
      <li v-for="(m, i) in messages" :key="i" :class="m.role">{{ m.content || "…" }}</li>
    </ol>
    <p v-if="queued" class="muted">Waking up the GPU. You're billed from now until a minute after the reply.</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <form class="composer panel" @submit.prevent="send">
      <textarea
        v-model="draft"
        aria-label="Message"
        placeholder="Type a message. Enter sends, Shift+Enter adds a line."
        rows="2"
        @keydown.enter.exact.prevent="send"
      />
      <button class="primary" :disabled="busy || !draft.trim()">Send</button>
    </form>
  </section>
</template>

<style scoped>
.chat {
  display: grid;
  gap: 1rem;
}
header {
  display: grid;
  gap: 0.25rem;
  justify-items: start;
}
header button {
  padding-left: 0;
}
.messages {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.75rem;
}
.messages li {
  white-space: pre-wrap;
  max-width: 85%;
  padding: 0.6rem 0.9rem;
  border-radius: 14px;
}
.user {
  justify-self: end;
  background: var(--hose);
  color: var(--surface);
}
.assistant {
  background: var(--surface);
  border: 1px solid var(--line);
}
.composer {
  position: sticky;
  bottom: 1rem;
  display: flex;
  gap: 0.5rem;
  padding: 0.5rem;
  align-items: end;
}
.composer textarea {
  border: none;
  resize: none;
}
</style>
