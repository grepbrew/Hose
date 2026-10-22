<script setup lang="ts">
import type { Fleet } from "../fleet";

defineProps<{ fleet: Fleet }>();
defineEmits<{ settings: [] }>();

const money = (n: number | null, digits = 2) => (n == null ? "…" : `$${n.toFixed(digits)}`);
</script>

<template>
  <header class="bar" :class="{ flowing: fleet.ratePerHr.value > 0 }">
    <strong class="name">Hose</strong>
    <dl class="meter">
      <div>
        <dt>Balance</dt>
        <dd>{{ money(fleet.s.balance) }}</dd>
      </div>
      <div title="What your GPUs that are on cost right now. $0.00 when everything is off.">
        <dt>Now</dt>
        <dd>{{ money(fleet.ratePerHr.value) }}/hr</dd>
      </div>
      <div title="Estimated from the GPU time used since you opened Hose.">
        <dt>This session</dt>
        <dd>≈ {{ money(fleet.s.session, 3) }}</dd>
      </div>
    </dl>
    <button class="quiet" @click="$emit('settings')">Keys</button>
  </header>
  <p v-if="fleet.s.error" class="error banner" role="alert">{{ fleet.s.error }}</p>
</template>

<style scoped>
.bar {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 1.5rem;
  padding: 0.7rem 1.25rem;
  background: var(--surface);
  border-bottom: 3px solid var(--line);
}
.name {
  font-family: var(--round);
  font-size: 1.2rem;
  color: var(--hose);
}
.meter {
  display: flex;
  gap: 1.75rem;
  margin: 0 auto 0 0;
}
dt {
  font-size: 0.75rem;
  color: var(--muted);
}
dd {
  margin: 0;
  font-family: var(--round);
  font-size: 1.15rem;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
}
/* Money is flowing: the bar's bottom edge runs like water through a hose. */
.flowing {
  border-image: repeating-linear-gradient(90deg, var(--hose) 0 14px, var(--hose-soft) 14px 28px) 1;
  animation: flow 1.2s linear infinite;
}
.flowing dd {
  color: var(--hose);
}
@keyframes flow {
  to {
    border-image-source: repeating-linear-gradient(90deg, var(--hose-soft) 0 14px, var(--hose) 14px 28px);
  }
}
@media (prefers-reduced-motion: reduce) {
  .flowing {
    animation: none;
  }
}
.banner {
  margin: 0;
  padding: 0.5rem 1.25rem;
  background: var(--surface);
  border-bottom: 1px solid var(--line);
}
@media (max-width: 640px) {
  .bar {
    flex-wrap: wrap;
    gap: 0.75rem;
  }
  .meter {
    gap: 1rem;
  }
}
</style>
