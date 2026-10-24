<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { isTauri } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { label, ago, usd, spendTotals, volumePerMo, type Config, type Sel } from "../cost";
import type { Fleet } from "../fleet";
import Icon from "./Icon.vue";

const props = defineProps<{ fleet: Fleet; sel: Sel }>();
const emit = defineEmits<{ select: [Sel] }>();

const f = props.fleet;
const isSel = (s: Sel) => JSON.stringify(s) === JSON.stringify(props.sel);

type Card = { sel: Sel; name: string; rate: string; note: string; kind: "on" | "starting" | "stray"; pct: number; barTitle: string };

// what's left before it turns itself off: idle minutes, else budget dollars, else nothing (on 24/7)
function offIn(c: Config) {
  const left = f.offInMin(c);
  if (left !== null) return { note: `off in ${left} min`, pct: (left / c.idleMin) * 100, title: `Turns itself off in ${left} of ${c.idleMin} quiet minutes` };
  if (c.budget) {
    const money = Math.max(0, c.budget - spendTotals(c).run);
    return { note: `${usd(money)} left`, pct: (money / c.budget) * 100, title: `Turns itself off when this run reaches ${usd(c.budget)}` };
  }
  return { note: "on 24/7", pct: 100, title: "Stays on until you turn it off" };
}
const running = computed<Card[]>(() => [
  ...f.groups.value.running.map((c): Card => {
    const st = f.state(c);
    const pod = f.podOf(c);
    const off = offIn(c);
    const starting = st === "Starting";
    return {
      sel: { kind: "config", key: c.key },
      name: c.name,
      rate: `${usd(pod?.cost ?? c.price)}/hr`,
      note: starting ? "loading model" : st === "Answering" ? "answering" : off.note,
      kind: starting ? "starting" : "on",
      pct: starting ? 40 : off.pct,
      barTitle: starting ? "Downloading and loading the model" : off.title,
    };
  }),
  ...f.groups.value.strays.map(
    (p): Card => ({ sel: { kind: "stray", podId: p.id }, name: p.name, rate: `${usd(p.cost)}/hr`, note: "not on this Mac", kind: "stray", pct: 0, barTitle: "" }),
  ),
]);
const TILE = {
  on: { bg: "var(--accent-soft)", fg: "var(--accent)", icon: "lightning-fill" },
  starting: { bg: "rgba(183, 121, 31, 0.14)", fg: "var(--amber)", icon: "circle-notch" },
  stray: { bg: "var(--hover)", fg: "var(--muted)", icon: "link-break" },
} as const;

const saved = computed(() =>
  f.groups.value.saved.map((c) => {
    const auto = c.name === `${label(c.id)} · ${c.gpuName}`;
    return {
      key: c.key,
      name: c.name,
      // a kept model bills while off, so it says so here first
      sub: c.volumeId
        ? `stored · ≈ ${usd(volumePerMo(c.volumeGb ?? 0))}/mo`
        : !auto
          ? `${label(c.id)} · ${c.gpuName}`
          : c.last?.startedAt
            ? `last on ${ago(c.last.startedAt, f.s.now)}`
            : "not turned on yet",
    };
  }),
);

// Settings menu
const menu = ref(false);
const THEMES = [
  ["system", "System"],
  ["light", "Light"],
  ["dark", "Dark"],
] as const;
const read = () => {
  try {
    return localStorage.getItem("hose.theme") ?? "system";
  } catch {
    return "system";
  }
};
const theme = ref(read());
function setTheme(t: string) {
  theme.value = t;
  try {
    localStorage.setItem("hose.theme", t);
  } catch {}
  if (t === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}
const version = ref("");
onMounted(async () => (version.value = isTauri() ? await getVersion() : "dev"));
function open(s: Sel) {
  menu.value = false;
  emit("select", s);
}
</script>

<template>
  <nav class="side" aria-label="Pods">
    <div class="strip" data-tauri-drag-region />

    <div class="brand" data-tauri-drag-region><span class="pop">Hose</span><i /></div>

    <div class="new">
      <button class="btn" :class="{ primary: sel.kind === 'new' }" @click="emit('select', { kind: 'new' })">
        <Icon name="plus" :size="14" />
        New pod
      </button>
    </div>

    <div class="list">
      <template v-if="running.length">
        <div class="head label">
          <span>Running</span>
          <span class="money total" title="All running pods together">{{ usd(f.ratePerHr.value) }}/hr</span>
        </div>
        <TransitionGroup name="side" tag="div" class="group">
          <button
            v-for="r in running"
            :key="JSON.stringify(r.sel)"
            class="card pod"
            :class="{ active: isSel(r.sel) }"
            :aria-current="isSel(r.sel) ? 'page' : undefined"
            @click="emit('select', r.sel)"
          >
            <span class="top">
              <span class="tile" :style="{ background: TILE[r.kind].bg, color: TILE[r.kind].fg }">
                <Icon :name="TILE[r.kind].icon" :size="14" :class="{ spin: r.kind === 'starting' }" />
              </span>
              <span class="name">{{ r.name }}</span>
            </span>
            <span v-if="r.kind !== 'stray'" class="bar" :title="r.barTitle">
              <b :class="{ barload: r.kind === 'starting' }" :style="{ width: `${r.pct}%`, background: r.kind === 'starting' ? 'var(--amber)' : 'var(--accent)' }" />
            </span>
            <span class="meta">
              <span class="money">{{ r.rate }}</span>
              <span class="note">{{ r.note }}</span>
            </span>
          </button>
        </TransitionGroup>
      </template>

      <template v-if="saved.length">
        <div class="head label saved-head">Saved</div>
        <TransitionGroup name="side" tag="div" class="group">
          <button
            v-for="r in saved"
            :key="r.key"
            class="row"
            :class="{ active: isSel({ kind: 'config', key: r.key }) }"
            :aria-current="isSel({ kind: 'config', key: r.key }) ? 'page' : undefined"
            @click="emit('select', { kind: 'config', key: r.key })"
          >
            <Icon name="power" :size="15" class="muted" />
            <span class="two">
              <span class="name">{{ r.name }}</span>
              <span class="sub">{{ r.sub }}</span>
            </span>
          </button>
        </TransitionGroup>
      </template>
    </div>

    <div class="foot">
      <div v-if="f.ratePerHr.value > 0" class="flow" title="Money is flowing: at least one pod is billing" />
      <dl class="meter">
        <dt>Balance</dt>
        <dd class="money">{{ usd(f.s.balance) }}</dd>
        <dt title="What your pods that are on cost right now">Now</dt>
        <dd class="money" :class="{ live: f.ratePerHr.value > 0 }">{{ usd(f.ratePerHr.value) }}/hr</dd>
        <dt title="Estimated since you opened Hose">This session</dt>
        <dd class="money">≈ {{ usd(f.s.session, 3) }}</dd>
      </dl>
      <div class="settings">
        <!-- ponytail: a transparent scrim closes the menu on any outside click; no global listener -->
        <div v-if="menu" class="scrim" @click="menu = false" />
        <div v-if="menu" class="menu popin" role="menu" aria-label="Settings" @keydown.esc="menu = false">
          <button class="row" role="menuitem" @click="open({ kind: 'keys' })">
            <Icon name="key" class="muted" />
            <span class="two"><span class="name">Keys</span><span class="sub">RunPod key, Hugging Face token</span></span>
            <Icon name="caret-right" :size="12" class="muted" />
          </button>
          <div class="appearance">
            <span class="title"><Icon name="circle-half" class="muted" />Appearance</span>
            <div class="themes" role="group" aria-label="Appearance">
              <button v-for="[id, name] in THEMES" :key="id" role="menuitemradio" :aria-checked="theme === id" @click="setTheme(id)">{{ name }}</button>
            </div>
          </div>
          <div class="divider" />
          <div class="row about">
            <Icon name="info" class="muted" />
            <span class="two">
              <span class="name">About Hose</span>
              <span class="sub">Version {{ version }}</span>
              <span class="sub mono" title="Update Hose from Terminal">brew upgrade --cask hose</span>
            </span>
          </div>
        </div>
        <button
          class="row"
          :class="{ active: sel.kind === 'keys' || menu }"
          aria-haspopup="menu"
          :aria-expanded="menu"
          @click="menu = !menu"
          @keydown.esc="menu = false"
        >
          <Icon name="gear-six" />
          <span class="grow">Settings</span>
          <Icon name="caret-up" :size="12" class="muted" />
        </button>
      </div>
    </div>
  </nav>
</template>

<style scoped>
.side {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--sidebar);
  border-right: 1px solid var(--line);
}
.strip {
  height: 52px;
  flex: none;
}
.brand {
  padding: 0 18px 14px;
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.brand span {
  font-size: 18px;
  letter-spacing: -0.01em;
}
.brand i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
}
.new {
  padding: 0 12px 14px;
}
.new .btn {
  width: 100%;
}
.list {
  flex-grow: 1;
  min-height: 0;
  overflow: auto;
  padding: 0 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.group {
  position: relative; /* anchors rows that are leaving */
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 10px;
}
.saved-head {
  padding-top: 16px;
}
.total {
  font-size: 11px;
  letter-spacing: 0;
  text-transform: none;
}
.pod {
  font: inherit;
  text-align: left;
  color: inherit;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 9px 10px 10px;
  border-radius: 10px;
  border: 1px solid transparent;
  background: transparent;
}
.top {
  display: flex;
  align-items: center;
  gap: 10px;
}
.tile {
  width: 26px;
  height: 26px;
  flex: none;
  border-radius: 7px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.name {
  flex-grow: 1;
  min-width: 0;
  display: block;
  font-size: 12.5px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.bar {
  display: block;
  height: 3px;
  border-radius: 2px;
  background: var(--line);
  overflow: hidden;
}
.bar b {
  display: block;
  height: 100%;
  border-radius: 2px;
  transition: width 400ms var(--ease-out);
}
.meta {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 11px;
  color: var(--muted);
}
.meta .money {
  color: var(--ink);
}
.note {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.two {
  flex-grow: 1;
  min-width: 0;
}
.sub {
  display: block;
  font-size: 11px;
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.foot {
  flex: none;
  border-top: 1px solid var(--line);
}
.meter {
  margin: 0;
  padding: 12px 18px 8px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 5px 8px;
  font-size: 11.5px;
}
.meter dt {
  color: var(--muted);
}
.meter dd {
  margin: 0;
}
.meter .live {
  color: var(--accent);
}
.settings {
  position: relative;
  padding: 4px 8px 10px;
}
.settings > .row {
  position: relative;
  z-index: 5; /* above the scrim, so a second click closes the menu */
  font-size: 12.5px;
  font-weight: 500;
}
.grow {
  flex-grow: 1;
}
.menu {
  position: absolute;
  left: 8px;
  right: 8px;
  bottom: calc(100% - 4px);
  z-index: 5;
  padding: 6px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 12px;
  box-shadow:
    0 12px 32px rgba(0, 0, 0, 0.14),
    0 2px 6px rgba(0, 0, 0, 0.06);
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.appearance {
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.appearance .title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12.5px;
  font-weight: 500;
}
.themes {
  display: flex;
  border: 1px solid var(--line);
  border-radius: 8px;
  overflow: hidden;
}
.themes button {
  flex: 1;
  font: inherit;
  font-size: 11.5px;
  font-weight: 500;
  height: 26px;
  border: 0;
  cursor: pointer;
  background: transparent;
  color: var(--muted);
  transition:
    background var(--dur) var(--ease-out),
    color var(--dur) var(--ease-out);
}
.themes button[aria-checked="true"] {
  background: var(--accent);
  color: var(--accent-ink);
}
.divider {
  height: 1px;
  background: var(--line);
  margin: 2px 6px;
}
.menu svg {
  flex: none;
}
.menu .sub {
  white-space: normal;
}
.about {
  align-items: flex-start;
}
.about:hover {
  background: none;
}
.about .mono {
  font-size: 10.5px;
  white-space: nowrap;
}
/* sidebar rows move into place when a pod turns on or off */
.side-move,
.side-enter-active {
  transition:
    transform 220ms var(--ease-out),
    opacity 220ms var(--ease-out);
}
.side-leave-active {
  transition: opacity 150ms var(--ease-in);
  position: absolute;
  width: 100%;
}
.side-enter-from {
  opacity: 0;
  transform: translateY(-4px);
}
.side-leave-to {
  opacity: 0;
}
</style>
