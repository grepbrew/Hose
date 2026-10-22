<script setup lang="ts">
import { ref, computed, watchEffect } from "vue";
import { getGpus, getDatacenterName, getDataCenters } from "../api";
import { spendTotals, snapshotOf, diskGb, fitDisk, placeName, duration, ago, usd, VLLM_IMAGE, type Cloud, type Config, type Pod } from "../cost";
import type { Fleet } from "../fleet";
import Icon from "./Icon.vue";

// "Summary first" (mockup option C): spend tiles, the main action, then icon lists. Setup is editable only while Off.
const props = defineProps<{ fleet: Fleet; apiKey: string; config?: Config; stray?: Pod; busy: boolean }>();
const emit = defineEmits<{ turnOn: []; turnOff: []; changeGpu: []; forget: [] }>();

const f = props.fleet;
const IDLE_CHOICES = [2, 5, 10, 20, 30, 60];
const VLLM = `vLLM ${VLLM_IMAGE.split(":v")[1]}`;
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const cloudName = (c?: string) => (c === "COMMUNITY" ? "Community" : "Secure");

const on = computed(() => !!props.config?.podId);
const spend = computed(() => props.config && spendTotals(props.config));
const runs = computed(() => (props.config ? props.config.pastPodIds.length + (props.config.podId ? 1 : 0) : 0));

// A stray has no config, so its machine details are read live.
const strayDc = ref("");
watchEffect(async () => {
  const id = props.stray?.dataCenterId;
  strayDc.value = id ? await getDatacenterName(props.apiKey, id).catch(() => id) : "";
});
const machine = computed(() => (props.stray ? snapshotOf(props.stray, strayDc.value, f.s.now) : props.config?.last));

// The location picked for new pods: Europe, EU Romania 1, or nothing for anywhere
const where = ref("");
watchEffect(async () => {
  const loc = props.config?.location;
  where.value = loc ? placeName(loc, await getDataCenters(props.apiKey).catch(() => [])) : "";
});

const editing = ref(false);
const editError = ref("");
async function setCloud(c: Cloud) {
  const cfg = props.config!;
  editError.value = "";
  if (cfg.cloud === c) return;
  try {
    const g = (await getGpus(props.apiKey, c)).find((x) => x.id === cfg.gpuId);
    const price = g?.price[c === "SECURE" ? "secure" : "community"];
    if (!price) return void (editError.value = `${cfg.gpuName} isn't offered on ${cloudName(c)} cloud. Change the GPU instead.`);
    cfg.cloud = c;
    cfg.price = price;
    if (c === "COMMUNITY") cfg.location = undefined; // Community hosts don't report a location
  } catch (e) {
    editError.value = e instanceof Error ? e.message : String(e);
  }
}
// Only raising it is allowed: below the recommendation the model may not fit.
function setDisk(e: Event) {
  const el = e.target as HTMLInputElement;
  const cfg = props.config!;
  cfg.disk = fitDisk(Number(el.value), cfg.params);
  el.value = String(cfg.disk);
}
const confirming = ref(false);
</script>

<template>
  <div class="inner">
    <!-- Stray: what RunPod says, plus Turn off -->
    <template v-if="stray && machine">
      <div class="g2">
        <div class="tile">
          <span class="t">This run</span><span class="n">≈ {{ usd(machine.runSpend) }}</span><span class="t">{{ duration(f.s.now - Date.parse(stray.createdAt ?? "")) }} so far</span>
        </div>
        <div class="tile"><span class="t">Costs</span><span class="n">{{ usd(stray.cost) }}</span><span class="t">per hour</span></div>
      </div>
      <section class="sec">
        <div class="sechead"><span class="label">From RunPod</span></div>
        <div class="li">
          <Icon name="graphics-card" /><span>{{ stray.gpu?.id.replace(/^NVIDIA /, "") ?? "GPU" }}<small>{{ cloudName(stray.cloud) }} cloud</small></span>
        </div>
        <div class="li"><Icon name="package" /><span>{{ VLLM }}<small>Model isn't known on this Mac</small></span></div>
        <div v-if="machine.dataCenter" class="li"><Icon name="map-pin" /><span>{{ machine.dataCenter }}</span></div>
        <div class="li"><Icon name="cpu" /><span>{{ machine.vcpu }} vCPU · {{ machine.memoryGb }} GB RAM</span></div>
        <div class="li"><Icon name="hash" /><span class="mono">{{ stray.id }}</span></div>
      </section>
    </template>

    <template v-else-if="config && spend">
      <div class="g2">
        <template v-if="on">
          <div class="tile">
            <span class="t">This run</span><span class="n">≈ {{ usd(spend.run) }}</span>
            <span class="t">{{ config.last?.startedAt ? `${duration(f.s.now - Date.parse(config.last.startedAt))} so far` : "just started" }}</span>
          </div>
          <div class="tile">
            <span class="t">Spent all time</span><span class="n">≈ {{ usd(spend.allTime) }}</span><span class="t">{{ runs }} {{ runs === 1 ? "run" : "runs" }}</span>
          </div>
        </template>
        <template v-else>
          <div class="tile">
            <span class="t">Spent all time</span><span class="n">≈ {{ usd(spend.allTime) }}</span><span class="t">{{ runs }} {{ runs === 1 ? "run" : "runs" }}</span>
          </div>
          <div class="tile">
            <span class="t">Costs when on</span><span class="n">{{ config.price ? usd(config.price) : "—" }}</span><span class="t">per hour</span>
          </div>
        </template>
      </div>

      <button v-if="on" class="btn wide" type="button" :disabled="busy" @click="emit('turnOff')">{{ busy ? "Turning off…" : "Turn off" }}</button>
      <button v-else class="btn primary wide" type="button" :disabled="busy" @click="emit('turnOn')">{{ busy ? "Turning on…" : "Turn on" }}</button>

      <section class="sec">
        <div class="sechead">
          <span class="label">Setup</span>
          <span v-if="on" class="muted small">Turn off to edit</span>
          <button v-else class="btn quiet edit" type="button" @click="(editing = !editing), (editError = '')">{{ editing ? "Done" : "Edit" }}</button>
        </div>
        <div v-if="editing && !on" class="cedit">
          <div class="f">
            <span class="l">GPU</span>
            <button class="inputish" type="button" @click="emit('changeGpu')">
              <span>{{ config.gpuName }}{{ config.vram ? ` · ${config.vram} GB` : "" }}</span><span class="change">Change</span>
            </button>
          </div>
          <div class="f">
            <span class="l">Cloud</span>
            <div class="segc" role="group" aria-label="Cloud">
              <button type="button" :aria-pressed="config.cloud === 'SECURE'" @click="setCloud('SECURE')">Secure</button>
              <button type="button" :aria-pressed="config.cloud === 'COMMUNITY'" @click="setCloud('COMMUNITY')">Community</button>
            </div>
          </div>
          <div class="f">
            <label class="l" for="idle-edit">Turns off after</label>
            <select id="idle-edit" v-model.number="config.idleMin" class="inputish">
              <option v-for="n in IDLE_CHOICES" :key="n" :value="n">{{ n }} quiet min</option>
            </select>
          </div>
          <div class="f">
            <label class="l" for="disk-edit">Storage (GB)</label>
            <input id="disk-edit" type="number" class="inputish" :min="diskGb(config.params)" step="5" :value="config.disk ?? diskGb(config.params)" @change="setDisk" />
          </div>
          <p v-if="editError" class="error small" role="alert">{{ editError }}</p>
        </div>
        <template v-else>
          <div class="li">
            <Icon name="graphics-card" /><span>{{ config.gpuName }}{{ config.vram ? ` · ${config.vram} GB` : "" }}<small>{{ cloudName(config.cloud) }} cloud{{ where ? ` · ${where}` : "" }}</small></span>
          </div>
          <div class="li">
            <Icon name="timer" /><span>Turns off after {{ config.idleMin }} quiet min<small v-if="f.state(config) === 'On'">{{ f.offInMin(config) }} min left</small></span>
          </div>
          <div class="li">
            <Icon name="package" /><span class="wrap">{{ config.id }}<small>{{ VLLM }} · {{ config.disk ?? diskGb(config.params) }} GB disk</small></span>
          </div>
        </template>
      </section>

      <section class="sec">
        <div class="sechead"><span class="label">{{ on ? "This machine" : "Last run" }}</span></div>
        <template v-if="machine">
          <div class="li">
            <Icon name="map-pin" /><span>{{ machine.dataCenter || "Unknown data center" }}<small v-if="!on">A new pod can land elsewhere</small></span>
          </div>
          <div class="li"><Icon name="cpu" /><span>{{ machine.vcpu }} vCPU · {{ machine.memoryGb }} GB RAM</span></div>
          <div v-if="machine.startedAt" class="li">
            <Icon name="clock" />
            <span v-if="on">Up {{ duration(f.s.now - Date.parse(machine.startedAt)) }}<small>Started {{ clock(machine.startedAt) }}</small></span>
            <span v-else>Started {{ ago(machine.startedAt, f.s.now) }}, {{ clock(machine.startedAt) }}</span>
          </div>
          <div v-if="on || config.pastPodIds.length" class="li">
            <Icon name="hash" />
            <span class="inline"><span class="mono">{{ on ? config.podId : config.pastPodIds.at(-1) }}</span><span v-if="!on" class="badge">deleted</span></span>
          </div>
        </template>
        <p v-else class="muted small">{{ on ? "Waiting for RunPod…" : "Not turned on yet." }}</p>
      </section>

      <p class="muted tiny">Spend is estimated from run time × the hourly price.</p>

      <div class="del">
        <div v-if="confirming" class="cedit confirm">
          <span>Delete this config? Its chat and spend history go too. Your RunPod account isn't touched.</span>
          <span class="row-btns">
            <button class="btn danger" type="button" :disabled="busy" @click="emit('forget')">Delete</button>
            <button class="btn quiet" type="button" @click="confirming = false">Keep</button>
          </span>
        </div>
        <button v-else class="btn quiet danger" type="button" @click="confirming = true">Delete config…</button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.inner {
  width: 288px;
  height: 100%;
  overflow: auto;
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.g2 {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
.tile {
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  background: var(--surface);
}
.tile .t {
  font-size: 11px;
  color: var(--muted);
}
/* money: Helvetica Neue tabular figures (Poppins has none) */
.tile .n {
  font-variant-numeric: tabular-nums;
  font-size: 17px;
  font-weight: 600;
}
.wide {
  width: 100%;
}
.sec {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.sechead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 24px;
}
.btn.quiet.edit {
  height: 24px;
  padding: 0 6px;
  font-size: 12px;
  color: var(--accent);
}
.li {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  font-size: 12.5px;
  line-height: 1.4;
}
.li svg {
  flex: none;
  margin-top: 1px;
  color: var(--muted);
}
.li small {
  display: block;
  font-size: 11.5px;
  color: var(--muted);
}
.wrap {
  min-width: 0;
  overflow-wrap: anywhere;
}
.inline {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.small {
  font-size: 11.5px;
}
.tiny {
  font-size: 11px;
}
.f {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.f .l {
  font-size: 11px;
  color: var(--muted);
}
.inputish {
  font: inherit;
  font-size: 12.5px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface);
  color: var(--ink);
  cursor: pointer;
  transition: border-color var(--dur) var(--ease-out);
}
.inputish:hover {
  border-color: var(--muted);
}
select.inputish {
  appearance: auto;
}
.change {
  color: var(--accent);
  font-weight: 500;
}
.cedit {
  display: flex;
  flex-direction: column;
  gap: 10px;
  animation: rise 220ms var(--ease-out) both;
}
.confirm {
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 10px 12px;
  gap: 8px;
  font-size: 12px;
}
.row-btns {
  display: flex;
  gap: 6px;
}
.del {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}
.del > .btn {
  padding: 0 6px;
}
</style>
