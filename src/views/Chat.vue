<script setup lang="ts">
import { ref, computed, nextTick, onMounted } from "vue";
import { chatStream } from "../api";
import { label, type Config } from "../cost";
import type { Fleet } from "../fleet";

const props = defineProps<{ vllmKey: string; config: Config; fleet: Fleet }>();

// History lives in the fleet (memory only), so it survives switching to another pod and back.
const messages = computed(() => props.fleet.chatOf(props.config));
const draft = ref("");
const busy = ref(false);
const error = ref("");
const list = ref<{ $el: HTMLElement }>(); // the TransitionGroup; $el is the <ol>

const state = computed(() => props.fleet.state(props.config));
const scroll = () => nextTick(() => list.value?.$el.lastElementChild?.scrollIntoView({ block: "end" }));
onMounted(scroll);
// ponytail: keep the last 20 turns so long chats stay inside the 8192-token context; token-count trimming if that bites
const HISTORY = 20;

async function send() {
  const text = draft.value.trim();
  const podId = props.config.podId;
  if (!text || busy.value || !podId || state.value !== "On") return;
  const msgs = messages.value;
  draft.value = "";
  error.value = "";
  busy.value = true;
  props.fleet.s.answering = podId;
  msgs.push({ role: "user", content: text });
  const history = msgs.slice(-HISTORY);
  msgs.push({ role: "assistant", content: "" });
  const reply = msgs[msgs.length - 1];
  scroll();
  try {
    await chatStream(podId, props.vllmKey, props.config.id, history, (t) => {
      reply.content = t;
      scroll();
    });
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
    props.fleet.s.answering = "";
    props.fleet.touch(podId);
    if (!reply.content) msgs.pop();
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
  <section class="chat" aria-label="Chat">
    <TransitionGroup ref="list" tag="ol" name="msg" class="messages" aria-live="polite">
      <li v-if="!messages.length" key="hello" class="empty muted">Say hello to {{ label(config.id) }}.</li>
      <li v-for="(m, i) in messages" :key="i" :class="m.role">{{ m.content || "…" }}</li>
    </TransitionGroup>
    <p v-if="state === 'Starting'" class="note muted">Still downloading and loading the model, 2–5 min. Chat opens up when it's on.</p>
    <p v-if="error" class="note error" role="alert">{{ error }}</p>
    <form class="composer" @submit.prevent="send">
      <label class="grow">
        <span class="sr">Message</span>
        <textarea
          v-model="draft"
          aria-label="Message"
          :placeholder="`Message ${label(config.id)}…`"
          rows="2"
          @keydown.enter.exact="onEnter"
        />
        <span class="kbd muted">Enter sends · Shift+Enter adds a line</span>
      </label>
      <button class="btn primary" :disabled="busy || !draft.trim() || state !== 'On'">Send</button>
    </form>
  </section>
</template>

<style scoped>
.chat {
  flex-grow: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.messages {
  width: 100%;
  max-width: 820px;
  align-self: center;
  list-style: none;
  margin: 0;
  padding: 28px 28px 8px;
  flex-grow: 1;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
  font-size: 13px;
  line-height: 1.5;
}
.messages li {
  white-space: pre-wrap;
}
.user {
  align-self: flex-end;
  max-width: 78%;
  background: var(--accent);
  color: var(--accent-ink);
  padding: 9px 13px;
  border-radius: 14px 14px 4px 14px;
}
.assistant {
  align-self: flex-start;
  max-width: 85%;
  background: var(--surface);
  border: 1px solid var(--line);
  padding: 10px 14px;
  border-radius: 14px 14px 14px 4px;
}
.empty {
  align-self: center;
  margin: auto 0;
}
.note {
  width: 100%;
  max-width: 780px;
  align-self: center;
  padding: 0 20px;
  font-size: 12px;
}
.composer {
  width: calc(100% - 40px);
  max-width: 780px;
  align-self: center;
  margin: 8px 20px 22px;
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 10px 10px 10px 14px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 12px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
}
.grow {
  flex-grow: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
textarea {
  font: inherit;
  font-size: 13px;
  color: var(--ink);
  background: transparent;
  border: 0;
  resize: none;
  outline: none;
  width: 100%;
}
.kbd {
  font-size: 10.5px;
}
/* messages rise in */
.msg-enter-active {
  transition:
    opacity 240ms var(--ease-out),
    transform 240ms var(--ease-out);
}
.msg-enter-from {
  opacity: 0;
  transform: translateY(6px);
}
</style>
