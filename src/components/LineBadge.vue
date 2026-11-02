<script setup>
/**
 * LineBadge – two-part pill badge for a TCL line (display only).
 *
 *   [ prefix | number ]   e.g.  [ C | 13 ]  [ T | 1 ]  [ TB | 11 ]
 *
 * LEFT half  → group color (TCL red, or the tram's own brand color)
 * RIGHT half → line brand color + number; the default slot lets callers
 *              append icons (direction arrow, check mark…) inside it.
 *
 * Props:
 *   line – line object from the API
 *   size – 'sm' | 'md'
 */
import { computed } from 'vue'
import { getLineGroupInfo } from '@/utils/lineGroup'

const props = defineProps({
  line: { type: Object, required: true },
  size: { type: String, default: 'md' },
})

const info = computed(() => getLineGroupInfo(props.line))
</script>

<template>
  <span class="lb" :class="'lb--' + size" :title="line.lName">
    <span class="lb__prefix" :style="{ background: info.prefixColor }">{{ info.prefix }}</span>
    <span class="lb__number" :style="{ background: '#' + line.color, color: '#' + line.textColor }">
      {{ info.number }}<slot />
    </span>
  </span>
</template>

<style scoped>
.lb {
  flex-shrink: 0;
  display: inline-flex;
  align-items: stretch;
  gap: 2px;
  border-radius: 99px;
  overflow: hidden;
  background: #fff;
  font-weight: 800;
  white-space: nowrap;
  line-height: 1;
}
.lb--md { height: 26px; font-size: 11px; }
.lb--sm { height: 24px; font-size: 10px; }

.lb__prefix,
.lb__number {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  /* hairline so white/very light brand colors still read as a badge */
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.06);
}
.lb__prefix {
  color: #fff;
  letter-spacing: 0.04em;
}
.lb__number { letter-spacing: 0.02em; }

.lb--md .lb__prefix,
.lb--md .lb__number { padding: 0 10px; }
.lb--sm .lb__prefix,
.lb--sm .lb__number { padding: 0 8px; }

/* Round the outer ends only (the gap shows white between halves) */
.lb__prefix { border-radius: 99px 0 0 99px; }
.lb__number { border-radius: 0 99px 99px 0; }
</style>
