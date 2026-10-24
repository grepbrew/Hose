<script setup lang="ts">
import { ref, computed, nextTick } from "vue";
import { moveTo, ago, usd, offText, allDay, volumePerMo, spendTotals, type Cloud, type Config, type GpuCard, type Pod } from "../cost";
import type { Fleet } from "../fleet";
import Chat from "./Chat.vue";
import ChatList from "./ChatList.vue";
import Details from "./Details.vue";
import GpuPicker from "./GpuPicker.vue";
import Icon from "./Icon.vue";

// One saved config (On, Starting or Off) or one stray pod: chat on the left, details on the right.
const props = defineProps<{ fleet: Fleet; apiKey: string; vllmKey: string; config?: Config; stray?: Pod }>();

const f = props.fleet;
const state = computed(() => (props.config ? f.state(props.config) : "On"));
const pod = computed(() => props.stray ?? (props.config && f.podOf(props.config)));
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

// details column, remembered across launches
const read = () => {
  try {
    return localStorage.getItem("hose.details") !== "0";
  } catch {
    return true;
  }
};
const showDetails = ref(read());
function toggle() {
  showDetails.value = !showDetails.value;
  try {
    localStorage.setItem("hose.details", showDetails.value ? "1" : "0");
  } catch {}
}

// details column tabs (mockup C): the config's chats, or the pod itself
// ponytail: tab not remembered across pods/launches; localStorage like hose.details if people ask
const tab = ref<"chats" | "pod">("chats");
// Off: the page shows the "This pod is off" panel until a chat is picked in the Chats tab, then that chat read-only
const reading = ref(false);
function newChat() {
  f.newChat(props.config!);
  reading.value = false;
}

// inline rename
const renaming = ref(false);
const draft = ref("");
const input = ref<HTMLInputElement>();
function startRename() {
  draft.value = props.config!.name;
  renaming.value = true;
  nextTick(() => input.value?.select());
}
function commit() {
  if (renaming.value && draft.value.trim()) props.config!.name = draft.value.trim();
  renaming.value = false;
}

const busy = ref(false);
const error = ref("");
async function run(fn: () => Promise<unknown>, what: string) {
  busy.value = true;
  error.value = "";
  try {
    await fn();
  } catch (e) {
    error.value = `Couldn't ${what}: ${errorText(e)}`;
  } finally {
    busy.value = false;
  }
}
// set when the volume's data center had no free GPU and Turn on went elsewhere
const moved = ref("");
const turnOn = () =>
  run(async () => {
    const c = props.config!;
    moved.value = (await f.turnOn(c)) ? `No free ${c.gpuName} in ${c.volumeDc} right now, so this pod downloads the model again.` : "";
  }, "turn it on");
const turnOnLabel = computed(() => {
  const c = props.config!;
  if (busy.value) return "Turning on…";
  return allDayCost.value ? `Turn on 24/7 · ${c.gpuName} · ≈ ${usd(allDayCost.value.month, 0)}/mo` : `Turn on · ${c.gpuName}${c.price ? ` · ${usd(c.price)}/hr` : ""}`;
});
const removeStorage = () => run(() => f.removeStorage(props.config!), "remove its storage");
// a pod RunPod never started: delete it and ask for a new one
const retry = () =>
  run(async () => {
    await f.turnOff(props.config!);
    await f.turnOn(props.config!);
  }, "try another machine");

// how it turns itself off, for the header: idle minutes left, budget left, or on 24/7
const allDayCost = computed(() => (props.config && !props.config.idleMin && !props.config.budget && props.config.price ? allDay(props.config.price) : null));
const storageMo = computed(() => (props.config?.volumeId ? usd(volumePerMo(props.config.volumeGb ?? 0)) : ""));
const offNote = computed(() => {
  const c = props.config!;
  const left = f.offInMin(c);
  if (left !== null) return `· turns off in ${left} min`;
  if (c.budget) return `· ${usd(Math.max(0, c.budget - spendTotals(c).run))} left this run`;
  return "· on 24/7";
});
const turnOff = () => run(() => (props.stray ? f.turnOffPod(props.stray.id) : f.turnOff(props.config!)), "turn it off");
const forget = () => run(() => f.forget(props.config!), "delete it");

// Change GPU (Off only): the picker takes over the chat column
const picking = ref(false);
const pickCloud = ref<Cloud>("SECURE");
const pickLocation = ref("");
const pick = ref<GpuCard | null>(null);
function changeGpu() {
  pickCloud.value = props.config!.cloud;
  pickLocation.value = props.config!.location ?? "";
  pick.value = null;
  picking.value = true;
}
function useGpu() {
  moveTo(props.config!, pick.value!, pickCloud.value, pickLocation.value);
  picking.value = false;
}

const NOTE: Record<string, string> = { Starting: "· loading the model", Answering: "· answering", Off: "· not billing" };
</script>

<template>
  <section class="page-col">
    <header class="bar" data-tauri-drag-region>
      <template v-if="config">
        <input v-if="renaming" ref="input" v-model="draft" class="titleinput" aria-label="Pod name" @keydown.enter="commit" @keydown.esc="renaming = false" @blur="commit" />
        <button v-else class="titlebtn" title="Click to rename" @click="startRename">{{ config.name }}</button>
        <span class="status">
          <span class="dot" :class="state === 'Off' ? 'off' : state === 'Starting' ? 'starting' : 'on'" />
          <span class="st">{{ state }}</span>
          {{ state === "On" ? offNote : NOTE[state] }}
        </span>
      </template>
      <template v-else-if="stray">
        <h1 class="title">{{ stray.name }}</h1>
        <span class="tag">Not on this Mac</span>
      </template>
      <span class="grow" />
      <span v-if="pod" class="money rate">{{ usd(pod.cost) }}/hr</span>
      <span v-else-if="config?.price" class="muted when"><span class="money rate ink">{{ usd(config.price) }}/hr</span> when on</span>
      <button class="btn quiet icon" :aria-label="showDetails ? 'Hide details' : 'Show details'" :title="showDetails ? 'Hide details' : 'Show details'" @click="toggle">
        <Icon name="sidebar-simple" class="mirror" />
      </button>
    </header>
    <p v-if="error" class="pagerr error" role="alert">{{ error }}</p>
    <p v-else-if="moved && state !== 'Off'" class="pagerr muted" role="status">{{ moved }}</p>

    <div class="body">
      <section v-if="config && picking" class="picker">
        <div class="panel">
          <GpuPicker v-model:cloud="pickCloud" v-model:location="pickLocation" :api-key="apiKey" :model="config" :picked="pick?.id" @pick="pick = $event">
            <h2>Change GPU</h2>
          </GpuPicker>
          <div class="actions">
            <button class="btn primary" :disabled="!pick" @click="useGpu">{{ pick ? `Use ${pick.name} · ${usd(pick.price)}/hr` : "Pick a GPU" }}</button>
            <button class="btn quiet" @click="picking = false">Cancel</button>
          </div>
        </div>
      </section>

      <Chat v-else-if="config && (state !== 'Off' || (reading && config.chat))" :config="config" :fleet="fleet" :api-key="apiKey" :vllm-key="vllmKey" @retry="retry">
        <template #off>
          <div class="offbar" role="status">
            <Icon name="power" :size="18" class="muted" />
            <span class="what">
              <b>This pod is off</b>
              <span class="muted">Reading past chats is free. Turn it on to keep chatting.</span>
            </span>
            <button class="btn primary" type="button" :disabled="busy" @click="turnOn">{{ turnOnLabel }}</button>
          </div>
        </template>
      </Chat>

      <section v-else-if="config" class="empty">
        <div class="icon-tile"><Icon name="power" :size="22" /></div>
        <h1>This pod is off</h1>
        <p class="muted">
          Turn it on to chat.
          {{ config.volumeId ? "The model is kept in storage, so it starts faster." : "Downloading and loading the model takes 5–10 min." }}
          {{ config.idleMin || config.budget ? `It turns itself off ${offText(config)}, even if you close Hose.` : "It stays on 24/7 until you turn it off." }}
        </p>
        <button class="btn primary cta" type="button" :disabled="busy" @click="turnOn">{{ turnOnLabel }}</button>
        <template v-if="storageMo">
          <p class="muted small">Model kept in storage · ≈ {{ storageMo }}/mo, even while it's off.</p>
          <button class="btn quiet" type="button" :disabled="busy" @click="removeStorage">Remove storage · save ≈ {{ storageMo }}/mo</button>
          <p class="muted small">Turn on downloads the model again after that.</p>
        </template>
        <p v-if="config.last?.startedAt" class="muted small">
          Last run {{ ago(config.last.startedAt, f.s.now) }}{{ config.last.dataCenter ? `, ${config.last.dataCenter}` : "" }}
        </p>
      </section>

      <section v-else-if="stray" class="empty">
        <div class="icon-tile"><Icon name="link-break" :size="22" /></div>
        <h2>Running, but not set up here</h2>
        <p class="muted">
          This pod was started by Hose on another Mac, or its config was deleted. Hose can't chat with it from here. It still costs money while it runs.
        </p>
        <button class="btn primary cta" type="button" :disabled="busy" @click="turnOff">
          {{ busy ? "Turning off…" : `Turn off · stop paying ${usd(stray.cost)}/hr` }}
        </button>
      </section>

      <aside class="details" :class="{ hidden: !showDetails }" aria-label="Pod details" :inert="!showDetails">
        <div v-if="config" class="tabs" role="tablist" aria-label="Details">
          <button type="button" role="tab" :aria-selected="tab === 'chats'" @click="tab = 'chats'"><Icon name="chat-circle-dots" :size="14" />Chats</button>
          <button type="button" role="tab" :aria-selected="tab === 'pod'" @click="tab = 'pod'"><Icon name="sliders-horizontal" :size="14" />Pod</button>
        </div>
        <div class="pane" :role="config ? 'tabpanel' : undefined">
          <ChatList v-if="config && tab === 'chats'" :fleet="fleet" :config="config" @open="reading = true" @new="newChat" />
          <Details v-else :fleet="fleet" :api-key="apiKey" :vllm-key="vllmKey" :config="config" :stray="stray" :busy="busy" @turn-on="turnOn" @turn-off="turnOff" @change-gpu="changeGpu" @forget="forget" />
        </div>
      </aside>
    </div>
  </section>
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
  gap: 12px;
  padding: 0 12px 0 22px;
  border-bottom: 1px solid var(--line);
}
.titlebtn,
.titleinput {
  font: inherit;
  font-family: var(--pop);
  font-size: 14.5px;
  font-weight: 600;
  color: var(--ink);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 6px;
  padding: 3px 6px;
  margin-left: -6px;
  min-width: 0;
  max-width: 50%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: text;
  transition:
    border-color var(--dur) var(--ease-out),
    background var(--dur) var(--ease-out);
}
.titlebtn:hover,
.titleinput {
  border-color: var(--line);
  background: var(--surface);
}
.titleinput:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.title {
  font-size: 14.5px;
}
.status {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  color: var(--muted);
  white-space: nowrap;
}
.st {
  color: var(--ink);
  font-weight: 500;
}
.grow {
  flex-grow: 1;
}
.rate {
  font-size: 13px;
}
.when {
  font-size: 12px;
}
.ink {
  color: var(--ink);
}
.mirror {
  transform: scaleX(-1);
}
.pagerr {
  padding: 8px 22px;
  font-size: 12px;
  border-bottom: 1px solid var(--line);
  background: var(--surface);
}
.body {
  flex-grow: 1;
  min-height: 0;
  display: flex;
}
.empty {
  flex-grow: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: 32px;
  text-align: center;
}
.icon-tile {
  width: 56px;
  height: 56px;
  border-radius: 16px;
  background: var(--surface);
  border: 1px solid var(--line);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--muted);
}
.empty h1,
.empty h2 {
  font-size: 17px;
}
.empty p {
  max-width: 360px;
  font-size: 12.5px;
  line-height: 1.5;
}
.empty .small {
  font-size: 11.5px;
}
.picker {
  flex-grow: 1;
  min-width: 0;
  overflow: auto;
  padding: 22px 28px;
}
.panel {
  max-width: 960px;
  margin: 0 auto;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.panel h2 {
  font-size: 14px;
}
.actions {
  display: flex;
  gap: 8px;
}
/* the off bar where the composer goes, while reading a past chat */
.offbar {
  width: calc(100% - 40px);
  max-width: 780px;
  align-self: center;
  margin: 8px 20px 22px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 12px 12px 16px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 12px;
}
.offbar .what {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  font-size: 12px;
}
.offbar b {
  font-size: 13px;
  font-weight: 500;
}
/* Chats | Pod, as a segmented pair */
.tabs {
  flex: none;
  width: 288px;
  display: flex;
  gap: 4px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--line);
}
.tabs button {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 30px;
  font: inherit;
  font-size: 12.5px;
  font-weight: 500;
  color: var(--muted);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 8px;
  cursor: pointer;
  transition:
    background var(--dur) var(--ease-out),
    color var(--dur) var(--ease-out);
}
.tabs button:hover {
  color: var(--ink);
}
.tabs button[aria-selected="true"] {
  color: var(--ink);
  background: var(--paper);
  border-color: var(--line);
}
.pane {
  flex: 1;
  min-height: 0;
}
/* details column slides: ease-out open, ease-in close */
.details {
  width: 289px;
  flex: none;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-left: 1px solid var(--line);
  background: var(--surface);
  transition:
    width 240ms var(--ease-out),
    opacity 200ms var(--ease-out),
    border-color 200ms var(--ease-out);
}
.details.hidden {
  width: 0;
  opacity: 0;
  border-left-color: transparent;
  transition:
    width 200ms var(--ease-in),
    opacity 160ms var(--ease-in),
    border-color 160ms var(--ease-in);
}
</style>
