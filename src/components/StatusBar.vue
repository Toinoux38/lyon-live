<script setup>
/**
 * StatusBar – live vehicle count (split by mode) and errors.
 */
import { computed } from 'vue'
import { useBusStore } from '@/store/busStore'

const store = useBusStore()

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`
}

const summary = computed(() => {
  const parts = []
  if (store.tramCount) parts.push(plural(store.tramCount, 'tram', 'trams'))
  if (store.busCount) parts.push(plural(store.busCount, 'bus', 'buses'))
  return parts.join(' · ')
})
</script>

<template>
  <div class="status-bar" v-if="store.activeLineCount > 0 || store.error" role="status">
    <span
      class="status-bar__dot"
      :class="{
        'status-bar__dot--active': store.isPolling && !store.error,
        'status-bar__dot--error': store.error,
      }"
    />
    <span v-if="store.error" class="status-bar__error">{{ store.error }}</span>
    <span v-else-if="store.vehicleCount > 0" class="status-bar__text">
      {{ summary }} live
    </span>
    <span v-else class="status-bar__text">
      Nothing running right now
    </span>
  </div>
</template>

<style scoped>
.status-bar {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 7px 14px;
  background: #fff;
  border-radius: 20px;
  box-shadow: 0 2px 12px rgba(0,0,0,0.12);
  font-size: 13px;
  min-height: 34px;
}

.status-bar__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #d1d5db;
  flex-shrink: 0;
}
.status-bar__dot--active {
  background: #10b981;
  box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.2);
  animation: pulse 2s ease-in-out infinite;
}
.status-bar__dot--error {
  background: #ef4444;
  box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.2);
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.status-bar__text {
  color: #6b7280;
  font-weight: 600;
  white-space: nowrap;
}

.status-bar__error {
  color: #ef4444;
  font-size: 12px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
</style>
