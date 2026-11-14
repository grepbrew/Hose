<script setup lang="ts">
import { ref, computed } from "vue";
import { codingTools, setupTool, type CodingTools } from "../api";
import { setupLabel } from "../cost";
import type { Fleet } from "../fleet";
import Icon from "./Icon.vue";

// Settings › Coding tools: one Set up for every installed tool. Setup is per Mac: Hose's own files point the tools at
// its relay (src-tauri/src/relay.rs); each chat model's Pod tab then shows the command for that model.
const props = defineProps<{ fleet: Fleet }>();

const tools = ref<CodingTools | null>(null);
const error = ref("");
const busy = ref(false);
const written = ref<string[]>([]);
const load = () => codingTools().then((t) => (tools.value = t), (e) => (error.value = String(e)));
load();

const rows = computed(() => {
  const t = tools.value;
  if (!t) return [];
  return [
    { tool: "claude" as const, name: "Claude Code", on: t.claude, setUp: t.claudeSetup },
    { tool: "codex" as const, name: "Codex", on: t.codex, setUp: t.codexSetup },
  ];
});
const label = computed(() => (tools.value ? setupLabel(tools.value) : ""));
const state = (r: { on: boolean; setUp: boolean }) => (!r.on ? "Not installed" : r.setUp ? "Set up" : "Installed, not set up");

async function setUp() {
  busy.value = true;
  error.value = "";
  try {
    written.value = [];
    for (const r of rows.value.filter((x) => x.on)) written.value.push(await setupTool(r.tool, props.fleet.relayKey()));
    await load();
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="page-col">
    <header class="bar" data-tauri-drag-region>
      <h1><span class="muted crumb">Settings ›</span> Coding tools</h1>
    </header>
    <div class="scroll">
      <div class="panel">
        <p class="muted intro">
          Claude Code and Codex can use the chat models on your Hose pods. Set them up once on this Mac, then copy the command from a model's Pod tab and run it in
          your project folder.
        </p>
        <p v-if="!tools && !error" class="muted intro">Looking for Claude Code and Codex…</p>
        <ul v-else class="tools">
          <li v-for="r in rows" :key="r.tool">
            <Icon :name="r.setUp ? 'check' : 'code'" :class="{ muted: !r.setUp }" />
            <span class="name">{{ r.name }}</span>
            <span class="muted state">{{ state(r) }}</span>
          </li>
        </ul>
        <p v-if="tools && !label" class="muted intro">Install Claude Code or Codex, then open this page again.</p>
        <div v-if="label" class="actions">
          <button class="btn primary" type="button" :disabled="busy" @click="setUp">{{ busy ? "Setting up…" : label }}</button>
        </div>
        <p v-if="written.length" class="muted intro">
          Wrote <code v-for="(p, i) in written" :key="p">{{ p }}{{ i < written.length - 1 ? ", " : "" }}</code>. Your own Claude Code and Codex settings stay as they
          were.
        </p>
        <p v-if="error || fleet.s.relayError" class="error intro" role="alert">{{ error || fleet.s.relayError }}</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* the same page as Settings › Keys (Setup.vue) */
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
  padding: 0 22px;
  border-bottom: 1px solid var(--line);
}
.bar h1 {
  font-size: 14.5px;
}
.crumb {
  font-weight: 500;
}
.scroll {
  flex-grow: 1;
  overflow: auto;
  padding: 28px;
}
.panel {
  max-width: 520px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 22px 24px;
}
.intro {
  font-size: 12.5px;
  line-height: 1.5;
}
.tools {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.tools li {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
.tools .name {
  font-weight: 600;
}
.tools .state {
  margin-left: auto;
  font-size: 12px;
}
.actions {
  display: flex;
}
</style>
