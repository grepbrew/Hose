<script setup lang="ts">
import { ref, computed, nextTick, onMounted, watch } from "vue";
import { chatStream, drawImage, podLogs, type LogLine, type Message } from "../api";
import { label, stuckBoot, seesImages, stepsOf, type Config } from "../cost";
import type { Fleet } from "../fleet";
import { md } from "../markdown";
import { toImages, MAX_IMAGES, saveImage, showInFinder } from "../images";
import Icon from "./Icon.vue";

const props = defineProps<{ apiKey: string; vllmKey: string; config: Config; fleet: Fleet }>();
const emit = defineEmits<{ retry: [] }>();

// History lives in the fleet (saved in SQLite by history.ts), so it survives switching pods and quitting Hose.
const messages = computed(() => props.fleet.chatOf(props.config));
const draft = ref("");
const busy = ref(false);
const error = ref("");
const list = ref<{ $el: HTMLElement }>(); // the TransitionGroup; $el is the <ol>

const state = computed(() => props.fleet.state(props.config));
const scroll = () => nextTick(() => list.value?.$el.lastElementChild?.scrollIntoView({ block: "end" }));
onMounted(scroll);
// While the pod boots, its RunPod logs (image pull, then vLLM downloading and loading the model) fill the chat area.
// Once it's on, Show log keeps them streaming under the chat (vLLM's requests and tokens/s).
// ponytail: last 300 lines in memory, plenty to see progress
const LOG_MAX = 300;
const logs = ref<LogLine[]>([]);
const logEl = ref<HTMLElement>();
const hms = (ts: string) => new Date(ts).toLocaleTimeString([], { hour12: false });
watch(
  () => (state.value === "Starting" || (props.config.log && state.value !== "Off") ? props.config.podId : ""),
  (podId, _, onCleanup) => {
    logs.value = [];
    if (!podId) return;
    const ctl = new AbortController();
    onCleanup(() => ctl.abort()); // ready (log hidden), another pod, or page left
    let since = "";
    const add = (l: LogLine) => {
      const el = logEl.value;
      const atEnd = !el || el.scrollHeight - el.scrollTop - el.clientHeight < 40; // don't yank someone reading back
      since = l.ts;
      logs.value.push(l);
      if (logs.value.length > LOG_MAX) logs.value.splice(0, logs.value.length - LOG_MAX);
      if (atEnd) nextTick(() => logEl.value && (logEl.value.scrollTop = logEl.value.scrollHeight));
    };
    (async () => {
      // the stream fails until the container exists and can drop mid-boot: resume from the last line every 5 s
      while (!ctl.signal.aborted) {
        await podLogs(props.apiKey, podId, since, add, ctl.signal).catch(() => {});
        await new Promise((r) => setTimeout(r, 5000));
      }
    })();
  },
  { immediate: true },
);
// no log line at all for minutes: RunPod's host never started the pod, so offer a new one (likely another machine)
const pod = computed(() => props.fleet.podOf(props.config));
const stuck = computed(() => state.value === "Starting" && stuckBoot(pod.value?.createdAt, props.fleet.s.now, logs.value.length));

// ponytail: keep the last 20 turns so long chats stay inside the model's context; token-count trimming if that bites.
// Images in those turns are sent again each time; drop old ones if long picture chats overflow it.
const HISTORY = 20;

// Photos, screenshots and PDF pages waiting to go with the next message, for a model that reads images
const vision = computed(() => seesImages(props.config));
const pending = ref<string[]>([]);
const attaching = ref(false);
const note = ref("");
const fileEl = ref<HTMLInputElement>();
// sent when there are images and no words: what people attach a page for
const READ = "Read out all the text in this image. Keep its layout, using Markdown for headings, lists and tables.";

async function attach(files: File[]) {
  files = files.filter((f) => f.type.startsWith("image/") || f.type === "application/pdf");
  if (!files.length) return;
  error.value = note.value = "";
  if (!vision.value) return void (error.value = `${label(props.config.id)} can't read images. Pick a model marked “reads images” in New pod.`);
  attaching.value = true;
  let more = false;
  try {
    for (const f of files) {
      const room = MAX_IMAGES - pending.value.length;
      if (room <= 0) {
        more = true;
        break;
      }
      const r = await toImages(f, room);
      pending.value.push(...r.images);
      more ||= r.more;
    }
  } catch {
    error.value = "Couldn't open that file. Try a PNG, JPEG or PDF.";
  } finally {
    attaching.value = false;
  }
  if (more) note.value = `Only the first ${MAX_IMAGES} images or pages go in one message.`;
}
const picked = (e: Event) => {
  const input = e.target as HTMLInputElement;
  void attach([...(input.files ?? [])]);
  input.value = ""; // the same file can be picked again
};
// a screenshot pastes as a file with no text; anything with text stays a text paste
const onPaste = (e: ClipboardEvent) => {
  const files = [...(e.clipboardData?.files ?? [])];
  if (!files.length || e.clipboardData!.getData("text/plain")) return;
  e.preventDefault();
  void attach(files);
};
const onDrop = (e: DragEvent) => void attach([...(e.dataTransfer?.files ?? [])]);

// A picture model: each message is a prompt on its own, the reply is a picture saved to ~/Pictures/Hose.
const draws = computed(() => !!props.config.draws);
// sizes vLLM-Omni takes as WxH; multiples of 64, about a megapixel each
const SHAPES = [
  ["1024x1024", "Square"],
  ["768x1344", "Portrait"],
  ["1344x768", "Landscape"],
] as const;
const shape = ref<string>(SHAPES[0][0]);
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function draw(podId: string, prompt: string, reply: Message) {
  const start = performance.now();
  const url = await drawImage(podId, props.vllmKey, props.config.id, prompt, shape.value, stepsOf(props.config.id));
  Object.assign(reply, { images: [url], stats: `${((performance.now() - start) / 1000).toFixed(1)} s` });
  scroll();
  // ponytail: a failed save leaves the picture in the chat only (right-click → Copy Image still works); the alert says why
  reply.file = await saveImage(url, prompt).catch((e) => ((error.value = `Couldn't save it to Pictures: ${errorText(e)}`), ""));
}

async function send() {
  const text = draft.value.trim() || (pending.value.length ? READ : "");
  const podId = props.config.podId;
  if (!text || busy.value || attaching.value || !podId || state.value !== "On") return;
  const msgs = messages.value;
  draft.value = "";
  error.value = note.value = "";
  busy.value = true;
  props.fleet.s.answering = podId;
  msgs.push({ role: "user", content: text, ...(pending.value.length ? { images: pending.value.splice(0) } : {}) });
  void props.fleet.remember(props.config, msgs.length - 1);
  const history = msgs.slice(-HISTORY);
  msgs.push({ role: "assistant", content: "" });
  const reply = msgs[msgs.length - 1];
  scroll();
  try {
    if (draws.value) await draw(podId, text, reply);
    else
      await chatStream(podId, props.vllmKey, props.config.id, history, !!props.config.think, (r) => {
        Object.assign(reply, r);
        scroll();
      });
  } catch (e) {
    error.value = errorText(e);
  } finally {
    busy.value = false;
    props.fleet.s.answering = "";
    props.fleet.touch(podId);
    // kept (a partial reply after an error too) → saved; the picture's file is set by now, draw() awaits the save
    if (!reply.content && !reply.thinking && !reply.images) msgs.pop();
    else void props.fleet.remember(props.config, msgs.indexOf(reply));
  }
}

// Copy button on a code block in a reply (markdown.ts puts it right before the <pre>)
const copy = (e: MouseEvent) => {
  const btn = (e.target as Element).closest(".copy");
  if (!btn) return;
  navigator.clipboard.writeText(btn.nextElementSibling?.textContent ?? "");
  btn.textContent = "Copied";
  setTimeout(() => (btn.textContent = "Copy"), 1500);
};

// Enter sends, Shift+Enter adds a line; never send while an IME (Chinese, Japanese, Korean) is composing.
const onEnter = (e: KeyboardEvent) => {
  if (e.isComposing || e.keyCode === 229) return;
  e.preventDefault();
  send();
};
</script>

<template>
  <section class="chat" aria-label="Chat" @dragover.prevent @drop.prevent="onDrop">
    <!-- aria-live off: hundreds of "Extracting" lines would flood a screen reader; the status note says what's happening -->
    <ol v-if="state === 'Starting'" ref="logEl" class="log" role="log" aria-label="Startup log" aria-live="off">
      <li v-if="stuck" class="wait stuck">
        <span>RunPod hasn't started this pod on its machine yet: no log lines for {{ Math.round((fleet.s.now - Date.parse(pod!.createdAt!)) / 60000) }} min, and it bills while it waits.</span>
        <button class="btn" type="button" @click="emit('retry')">Try another machine</button>
      </li>
      <li v-else-if="!logs.length" class="wait muted">Waiting for the pod's first log lines…</li>
      <li v-for="(l, i) in logs" :key="i" :class="l.source"><time :datetime="l.ts">{{ hms(l.ts) }}</time>{{ l.line }}</li>
    </ol>
    <TransitionGroup v-else ref="list" tag="ol" name="msg" class="messages" aria-live="polite">
      <li v-if="!messages.length" key="hello" class="empty muted">
        <template v-if="draws">Describe a picture for {{ label(config.id) }}. Each one is saved to your Pictures folder.</template>
        <template v-else>Say hello to {{ label(config.id) }}{{ vision ? ", or drop in a photo or PDF to read its text" : "" }}.</template>
      </li>
      <li v-for="(m, i) in messages" :key="i" :class="m.role" @click="copy">
        <details v-if="m.thinking" class="think" :open="!m.content">
          <summary>{{ m.content ? "Thought" : "Thinking…" }}</summary>
          <div class="md" v-html="md(m.thinking)" />
        </details>
        <template v-if="m.role === 'user'">
          <span v-if="m.images" class="shots"><img v-for="(src, j) in m.images" :key="j" :src="src" :alt="`Image ${j + 1}`" /></span>
          <span>{{ m.content }}</span>
        </template>
        <template v-else-if="m.images">
          <img class="picture" :src="m.images[0]" :alt="messages[i - 1]?.content" />
          <button v-if="m.file" class="link finder" type="button" @click="showInFinder(m.file)"><Icon name="folder-simple" :size="12" />Show in Finder</button>
        </template>
        <div v-else-if="m.content" class="md" v-html="md(m.content)" />
        <span v-else-if="!m.thinking">{{ draws ? "Drawing…" : "…" }}</span>
        <small v-if="m.stats" class="stats">{{ m.stats }}</small>
      </li>
    </TransitionGroup>
    <ol v-if="config.log && state !== 'Starting' && state !== 'Off'" ref="logEl" class="log tail" role="log" aria-label="Server log" aria-live="off">
      <li v-if="!logs.length" class="wait muted">Waiting for log lines…</li>
      <li v-for="(l, i) in logs" :key="i" :class="l.source"><time :datetime="l.ts">{{ hms(l.ts) }}</time>{{ l.line }}</li>
    </ol>
    <p v-if="state === 'Starting'" class="note muted">Still downloading and loading the model, 2–5 min. {{ draws ? "You can describe a picture" : "Chat opens up" }} when it's on.</p>
    <p v-if="error" class="note error" role="alert">{{ error }}</p>
    <p v-if="note" class="note muted" role="status">{{ note }}</p>
    <!-- a past chat read while the pod is off: PodPage's Turn on bar in place of the composer -->
    <slot v-if="state === 'Off'" name="off" />
    <form v-else class="composer" @submit.prevent="send">
      <div class="grow">
        <ul v-if="pending.length || attaching" class="attached" aria-label="Attached images">
          <li v-for="(src, i) in pending" :key="i">
            <img :src="src" :alt="`Image ${i + 1}`" />
            <button type="button" :aria-label="`Remove image ${i + 1}`" @click="pending.splice(i, 1)"><Icon name="x" :size="10" /></button>
          </li>
          <li v-if="attaching" class="muted reading">Reading…</li>
        </ul>
        <textarea
          v-model="draft"
          :aria-label="draws ? 'Describe a picture' : 'Message'"
          :placeholder="
            state === 'Starting'
              ? 'Chat opens when the model is ready…'
              : draws
                ? 'Describe a picture…'
                : pending.length
                  ? 'Ask about it, or Send to read out its text…'
                  : `Message ${label(config.id)}…`
          "
          :disabled="state === 'Starting'"
          rows="2"
          @keydown.enter.exact="onEnter"
          @paste="onPaste"
        />
        <div class="opts">
          <template v-if="vision">
            <button class="opt attach" type="button" aria-label="Attach image or PDF" title="A photo, screenshot or PDF. You can also paste or drop one." @click="fileEl?.click()">
              <Icon name="paperclip" :size="13" />Attach
            </button>
            <input ref="fileEl" type="file" accept="image/*,application/pdf" multiple hidden @change="picked" />
          </template>
          <div v-if="draws" class="seg shapes" role="group" aria-label="Shape">
            <button v-for="[size, name] in SHAPES" :key="size" type="button" :title="size.replace('x', ' × ')" :aria-pressed="shape === size" @click="shape = size">{{ name }}</button>
          </div>
          <label v-else class="opt"><input v-model="config.think" type="checkbox" />Think first</label>
          <span class="kbd muted">Enter sends · Shift+Enter adds a line</span>
          <button v-if="state !== 'Starting'" class="link" type="button" :aria-pressed="!!config.log" @click="config.log = !config.log">
            {{ config.log ? "Hide log" : "Show log" }}
          </button>
        </div>
      </div>
      <button class="btn primary" :disabled="busy || attaching || (!draft.trim() && !pending.length) || state !== 'On'">Send</button>
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
.user {
  white-space: pre-wrap;
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
/* startup log, styled after RunPod's Logs tab: time column, accent bar per line */
.log {
  width: calc(100% - 40px);
  max-width: 780px;
  align-self: center;
  flex-grow: 1;
  overflow: auto;
  list-style: none;
  margin: 20px 20px 8px;
  padding: 10px 0;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 12px;
  font-family: ui-monospace, Menlo, monospace;
  font-size: 11.5px;
  line-height: 1.6;
}
.log li {
  display: flex;
  gap: 14px;
  padding: 0 14px 0 10px;
  border-left: 2px solid var(--accent);
  margin-left: 4px;
  white-space: pre-wrap;
  word-break: break-word;
}
.log li.system {
  border-left-color: var(--line);
}
.log .wait {
  border-left-color: transparent;
}
.log .stuck {
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  border-left-color: var(--amber);
  font-family: var(--pop);
  font-size: 12.5px;
}
.log time {
  flex: none;
  color: var(--muted);
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
textarea:disabled {
  cursor: not-allowed;
}
.opts {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 10.5px;
}
.opt {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--muted);
  cursor: pointer;
}
.opt input {
  margin: 0;
}
.attach {
  font: inherit;
  background: none;
  border: 0;
  padding: 0;
}
.attach:hover {
  color: var(--ink);
}
/* images waiting to send, and the ones sent in a bubble */
.attached {
  list-style: none;
  margin: 0 0 4px;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.attached li {
  position: relative;
}
.attached img {
  display: block;
  height: 56px;
  max-width: 120px;
  object-fit: cover;
  border: 1px solid var(--line);
  border-radius: 6px;
}
.attached button {
  position: absolute;
  top: -5px;
  right: -5px;
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  padding: 0;
  color: var(--ink);
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 50%;
  cursor: pointer;
}
.reading {
  align-self: center;
  font-size: 11px;
}
.shots {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 6px;
}
/* a picture the model made, with its Finder link under it */
.picture {
  display: block;
  width: min(100%, 480px);
  max-height: 60vh;
  object-fit: contain;
  object-position: left;
  border-radius: 8px;
}
.link.finder {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin: 6px 0 0;
  font-size: 11px;
}
.shapes button {
  font-size: 10.5px;
  padding: 2px 9px;
}
.shots img {
  display: block;
  max-height: 140px;
  max-width: 100%;
  border-radius: 8px;
}
.link {
  margin-left: auto;
  font: inherit;
  background: none;
  border: 0;
  padding: 0;
  color: var(--accent);
  cursor: pointer;
}
/* reasoning, folded once the answer starts */
.think {
  margin-bottom: 6px;
  font-size: 12px;
  color: var(--muted);
}
.think summary {
  cursor: pointer;
  user-select: none;
}
.think[open] > div {
  display: block;
  margin-top: 4px;
  padding-left: 8px;
  border-left: 2px solid var(--line);
}
.stats {
  display: block;
  margin-top: 6px;
  font-size: 10.5px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
/* rendered markdown in replies (v-html, so :deep) */
.md :deep(:is(p, ul, ol, pre, table, blockquote, h1, h2, h3, h4, .code, .katex-display)) {
  margin: 0 0 0.6em;
}
.md > :deep(:last-child) {
  margin-bottom: 0;
}
.md :deep(:is(ul, ol)) {
  padding-left: 1.4em;
}
.md :deep(:is(h1, h2, h3, h4)) {
  font-size: 14px;
  font-weight: 600;
}
.md :deep(a) {
  color: var(--accent);
}
.md :deep(code) {
  font: 12px ui-monospace, Menlo, monospace;
  background: var(--hover);
  padding: 1px 4px;
  border-radius: 4px;
}
.md :deep(pre) {
  margin: 0;
  padding: 10px 12px;
  overflow: auto;
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 8px;
}
.md :deep(pre code) {
  background: none;
  padding: 0;
}
.md :deep(.code) {
  position: relative;
}
.md :deep(.copy) {
  position: absolute;
  top: 6px;
  right: 6px;
  font: inherit;
  font-size: 10.5px;
  padding: 1px 7px;
  color: var(--muted);
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 6px;
  cursor: pointer;
}
.md :deep(table) {
  border-collapse: collapse;
  display: block;
  overflow-x: auto;
}
.md :deep(:is(th, td)) {
  border: 1px solid var(--line);
  padding: 4px 8px;
}
.md :deep(blockquote) {
  padding-left: 10px;
  border-left: 3px solid var(--line);
  color: var(--muted);
}
.md :deep(.katex-display) {
  overflow-x: auto;
}
/* syntax colors from the theme tokens, so Light/Dark follow for free */
.md :deep(:is(.hljs-keyword, .hljs-selector-tag, .hljs-type)) {
  color: var(--accent);
}
.md :deep(:is(.hljs-string, .hljs-attr, .hljs-regexp)) {
  color: var(--amber);
}
.md :deep(:is(.hljs-number, .hljs-literal, .hljs-built_in)) {
  color: var(--danger);
}
.md :deep(:is(.hljs-comment, .hljs-meta)) {
  color: var(--muted);
  font-style: italic;
}
.md :deep(:is(.hljs-title, .hljs-section)) {
  font-weight: 600;
}
/* server log under the chat once it's on */
.log.tail {
  flex: 0 0 30%;
  min-height: 120px;
  margin-top: 0;
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
