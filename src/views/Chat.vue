<script setup lang="ts">
import { ref, computed, nextTick } from "vue";
import { chatStream, type Message } from "../api";
import type { Fleet, Saved } from "../fleet";

const props = defineProps<{ vllmKey: string; model: Saved; fleet: Fleet }>();
defineEmits<{ back: [] }>();

const messages = ref<Message[]>([]);
const draft = ref("");
const busy = ref(false);
const error = ref("");
const list = ref<HTMLElement>();

const state = computed(() => props.fleet.state(props.model));
const scroll = () => nextTick(() => list.value?.lastElementChild?.scrollIntoView({ block: "end" }));
// ponytail: keep the last 20 turns so long chats stay inside the 8192-token context; token-count trimming if that bites
const HISTORY = 20;

async function send() {
  const text = draft.value.trim();
  const podId = props.model.podId;
  if (!text || busy.value || !podId || state.value !== "On") return;
  draft.value = "";
  error.value = "";
  busy.value = true;
  props.fleet.s.answering = podId;
  messages.value.push({ role: "user", content: text });
  const history = messages.value.slice(-HISTORY);
  messages.value.push({ role: "assistant", content: "" });
  const reply = messages.value[messages.value.length - 1];
  scroll();
  try {
    await chatStream(podId, props.vllmKey, props.model.id, history, (t) => {
      reply.content = t;
      scroll();
    });
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
    props.fleet.s.answering = "";
    props.fleet.touch(podId);
    if (!reply.content) messages.value.pop();
  }
}

// Enter sends, Shift+Enter adds a line; never send while an IME (Chinese, Japanese, Korean) is composing.
const onEnter = (e: KeyboardEvent) => {
  if (e.isComposing || e.keyCode === 229) return;
  e.preventDefault();
  send();
};
</script>

<template>
  <section class="chat">
    <header>
      <button class="quiet" @click="$emit('back')">Back to models</button>
      <h1>{{ model.id.split("/").pop() }}</h1>
      <p class="muted">
        {{ state }} on {{ model.gpuName }}
        <template v-if="state === 'On'">· turns off {{ model.idleMin }} quiet minutes after your last message</template>
      </p>
    </header>

    <ol ref="list" class="messages" aria-live="polite">
      <li v-if="!messages.length" class="muted">Say hello.</li>
      <li v-for="(m, i) in messages" :key="i" :class="m.role">{{ m.content || "…" }}</li>
    </ol>
    <p v-if="state === 'Starting'" class="muted">Still downloading and loading the model. Chat opens up when it's on.</p>
    <p v-if="state === 'Off'" class="muted">This model is off. Go back to your models and turn it on to keep chatting.</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <form class="composer panel" @submit.prevent="send">
      <textarea
        v-model="draft"
        aria-label="Message"
        placeholder="Type a message. Enter sends, Shift+Enter adds a line."
        rows="2"
        @keydown.enter.exact="onEnter"
      />
      <button class="primary" :disabled="busy || !draft.trim() || state !== 'On'">Send</button>
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
