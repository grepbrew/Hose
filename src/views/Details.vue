<script setup lang="ts">
import { ref, computed, watchEffect } from "vue";
import { getGpus, getDatacenterName, getDataCenters, podUrl } from "../api";
import { spendTotals, snapshotOf, diskGb, fitDisk, placeName, duration, ago, usd, offText, allDay, volumePerMo, VLLM_IMAGE, seesImages, type Cloud, type Config, type Pod } from "../cost";
import type { Fleet } from "../fleet";
import Icon from "./Icon.vue";

// "Summary first" (mockup option C): spend tiles, the main action, then icon lists. Setup is editable only while Off.
const props = defineProps<{ fleet: Fleet; apiKey: string; vllmKey: string; config?: Config; stray?: Pod; busy: boolean }>();
const emit = defineEmits<{ turnOn: []; turnOff: []; changeGpu: []; forget: [] }>();

const f = props.fleet;
const IDLE_CHOICES = [2, 5, 10, 20, 30, 60];
const VLLM = `vLLM ${VLLM_IMAGE.split(":v")[1]}`;
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const cloudName = (c?: string) => (c === "COMMUNITY" ? "Community" : "Secure");

const on = computed(() => !!props.config?.podId);
const spend = computed(() => props.config && spendTotals(props.config));
const runs = computed(() => (props.config ? props.config.pastPodIds.length + (props.config.podId ? 1 : 0) : 0));

// on 24/7 (Never, no budget): what that costs a day and a month
const allDayCost = computed(() => (props.config && !props.config.idleMin && !props.config.budget && props.config.price ? allDay(props.config.price) : null));
const storageMo = computed(() => (props.config?.volumeId ? usd(volumePerMo(props.config.volumeGb ?? 0)) : ""));
const budgetLeft = computed(() => (props.config?.budget ? Math.max(0, props.config.budget - (spend.value?.run ?? 0)) : null));
function setBudget(e: Event) {
  props.config!.budget = Number((e.target as HTMLInputElement).value) || undefined;
}

// A stray has no config, so its machine details are read live.
const strayDc = ref("");
watchEffect(async () => {
  const id = props.stray?.dataCenterId;
  strayDc.value = id ? await getDatacenterName(props.apiKey, id).catch(() => id) : "";
});
const machine = computed(() => (props.stray ? snapshotOf(props.stray, strayDc.value, f.s.now) : props.config?.last));

// The location picked for new pods (Europe, EU Romania 1, or nothing for anywhere), and where the model's volume is
const where = ref("");
const volumeWhere = ref("");
watchEffect(async () => {
  const loc = props.config?.location;
  const dc = props.config?.volumeDc;
  const dcs = loc || dc ? await getDataCenters(props.apiKey).catch(() => []) : [];
  where.value = loc ? placeName(loc, dcs) : "";
  volumeWhere.value = dc ? placeName(dc, dcs) : "";
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

// The running model's OpenAI-compatible API, for other apps. A new pod (every Turn on) means a new address.
const ready = computed(() => props.config && ["On", "Answering"].includes(f.state(props.config)));
const apiRows = computed(() => [
  { what: "base URL", label: "Base URL", shown: `${podUrl(props.config!.podId!)}/v1`, value: `${podUrl(props.config!.podId!)}/v1` },
  { what: "API key", label: "API key", shown: "••••••••••••", value: props.vllmKey },
  { what: "model name", label: "Model", shown: props.config!.id, value: props.config!.id },
]);
const copied = ref("");
// ponytail: the webview's clipboard; tauri-plugin-clipboard-manager if WKWebView ever refuses it
const copy = (r: { what: string; value: string }) =>
  navigator.clipboard.writeText(r.value).then(() => {
    copied.value = r.what;
    setTimeout(() => copied.value === r.what && (copied.value = ""), 1500);
  });
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
      <button v-else class="btn primary wide" type="button" :disabled="busy" @click="emit('turnOn')">
        {{ busy ? "Turning on…" : allDayCost ? `Turn on 24/7 · ≈ ${usd(allDayCost.month, 0)}/mo` : "Turn on" }}
      </button>
      <p v-if="on && storageMo" class="muted tiny keep">The model stays in storage: ≈ {{ storageMo }}/mo until you remove it.</p>

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
              <option :value="0">Never</option>
            </select>
          </div>
          <div class="f">
            <label class="l" for="budget-edit">Turn off after spending ($)</label>
            <input id="budget-edit" type="number" class="inputish" min="0" step="1" placeholder="No limit" :value="config.budget ?? ''" @change="setBudget" />
          </div>
          <p v-if="allDayCost" class="warn small">Stays on 24/7 until you turn it off: ≈ {{ usd(allDayCost.day) }}/day · ≈ {{ usd(allDayCost.month, 0) }}/month.</p>
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
            <Icon name="timer" /><span>Turns off {{ offText(config) }}<small v-if="f.state(config) === 'On' && f.offInMin(config) !== null">{{ f.offInMin(config) }} min left</small><small v-if="on && budgetLeft !== null">{{ usd(budgetLeft) }} left this run</small><small v-if="allDayCost">≈ {{ usd(allDayCost.day) }}/day · ≈ {{ usd(allDayCost.month, 0) }}/month</small></span>
          </div>
          <div v-if="config.volumeId" class="li">
            <Icon name="package" /><span>{{ config.volumeGb }} GB storage · ≈ {{ storageMo }}/mo<small>Keeps the model{{ volumeWhere ? ` in ${volumeWhere}` : "" }} between runs</small></span>
          </div>
          <div class="li">
            <Icon name="package" /><span class="wrap">{{ config.id }}<small>{{ VLLM }} · {{ config.disk ?? diskGb(config.params) }} GB disk</small></span>
          </div>
        </template>
      </section>

      <section v-if="ready" class="sec">
        <div class="sechead"><span class="label">Use from other apps</span></div>
        <div v-for="r in apiRows" :key="r.what" class="f">
          <span class="l">{{ r.label }}</span>
          <button class="inputish" type="button" :aria-label="`Copy ${r.what}`" @click="copy(r)">
            <span class="mono clip">{{ r.shown }}</span><span class="change">{{ copied === r.what ? "Copied" : "Copy" }}</span>
          </button>
        </div>
        <p class="muted tiny">Works with any OpenAI-compatible app. The address changes each time you turn it on. Anyone with the key can use the model while it's on, and their requests keep it on.</p>
        <p v-if="seesImages(config!)" class="muted tiny">Takes images too: send them as <code>image_url</code> parts, like OpenAI's vision API.</p>
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

      <p class="muted tiny">Spend is GPU time, estimated from run time × the hourly price. Storage isn't counted.</p>

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
.keep {
  margin: -10px 0 0;
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
.clip {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
