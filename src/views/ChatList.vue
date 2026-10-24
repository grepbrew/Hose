<script setup lang="ts">
import { ref, computed } from "vue";
import { chatGroups } from "../history";
import type { Config, Fleet } from "../fleet";
import Icon from "./Icon.vue";

// The Chats tab (mockup C): this config's saved chats under Today / Yesterday / Earlier, title search, + for a new chat.
const props = defineProps<{ fleet: Fleet; config: Config }>();
const emit = defineEmits<{ open: []; new: [] }>();

const q = ref("");
const groups = computed(() => chatGroups(props.fleet.chatsOf(props.config), props.fleet.s.now, q.value));
// a reply still streaming belongs to the open chat: no switching until it's done
const locked = computed(() => props.fleet.state(props.config) === "Answering");
// ✕ asks once ("Delete"), then deletes: a chat can't come back
const armed = ref("");

function open(id: string) {
  props.fleet.openChat(props.config, id);
  emit("open");
}
function del(id: string) {
  if (armed.value !== id) return void (armed.value = id);
  armed.value = "";
  void props.fleet.deleteChat(props.config, id);
}
</script>

<template>
  <div class="chats">
    <div class="top">
      <label class="search">
        <Icon name="magnifying-glass" :size="13" />
        <input v-model="q" type="search" aria-label="Search chats" placeholder="Search chats" />
      </label>
      <button class="btn primary icon" type="button" aria-label="New chat" title="New chat" :disabled="locked" @click="emit('new')"><Icon name="plus" :size="14" /></button>
    </div>
    <section v-for="g in groups" :key="g.label" class="group">
      <h3 class="label">{{ g.label }}</h3>
      <div v-for="c in g.chats" :key="c.id" class="row" :class="{ on: c.id === config.chat }" @mouseleave="armed === c.id && (armed = '')">
        <button class="pick" type="button" :disabled="locked" :aria-current="c.id === config.chat ? 'true' : undefined" @click="open(c.id)">
          <span class="title">{{ c.title }}</span>
          <span class="when">{{ c.when }}</span>
        </button>
        <!-- one button, so keyboard focus stays on it between ✕ and Delete -->
        <button class="del" :class="{ sure: armed === c.id }" type="button" :aria-label="armed === c.id ? undefined : 'Delete chat'" title="Delete chat" :disabled="locked" @click="del(c.id)" @blur="armed === c.id && (armed = '')">
          <template v-if="armed === c.id">Delete</template>
          <Icon v-else name="x" :size="11" />
        </button>
      </div>
    </section>
    <p v-if="!groups.length" class="muted small empty">{{ q.trim() ? "No chat has that in its title." : "Your chats with this pod are kept here, on this Mac." }}</p>
  </div>
</template>

<style scoped>
.chats {
  width: 288px;
  height: 100%;
  overflow: auto;
  padding: 14px 10px 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.top {
  display: flex;
  gap: 6px;
  padding: 0 4px;
}
.search {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 7px;
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--paper);
  color: var(--muted);
}
.search:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.search input {
  flex: 1;
  min-width: 0;
  font: inherit;
  font-size: 12.5px;
  color: var(--ink);
  background: transparent;
  border: 0;
  outline: none;
  padding: 0;
}
.group {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.group h3 {
  margin: 0;
  padding: 8px 10px 4px;
}
.row {
  display: flex;
  align-items: center;
  border-radius: 8px;
  transition: background var(--dur) var(--ease-out);
}
.row:hover,
.row.on {
  background: var(--hover);
}
.pick {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 6px 10px;
  font: inherit;
  text-align: left;
  color: var(--ink);
  background: transparent;
  border: 0;
  cursor: pointer;
}
.pick:disabled,
.del:disabled {
  cursor: default;
}
.title {
  font-size: 12.5px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.when {
  font-size: 11px;
  color: var(--muted);
}
.del {
  flex: none;
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  margin-right: 4px;
  padding: 0;
  color: var(--muted);
  background: transparent;
  border: 0;
  border-radius: 6px;
  cursor: pointer;
}
.del:hover:not(:disabled) {
  color: var(--ink);
  background: var(--hover);
}
.del.sure {
  width: auto;
  padding: 0 8px;
  font: inherit;
  font-size: 11px;
  font-weight: 500;
  color: var(--danger);
  background: var(--surface);
  border: 1px solid var(--line);
}
.empty {
  padding: 4px 10px;
  line-height: 1.5;
}
</style>
