<script setup>
/**
 * StatusBar - Displays current tracking status: vehicle count,
 * polling state, and errors.
 */

import { useBusStore } from '@/store/busStore'

const store = useBusStore()
</script>

<template>
  <div class="status-bar" v-if="store.activeLineCount > 0 || store.error">
    <div class="status-bar__left">
      <span class="status-bar__dot" :class="{ 'status-bar__dot--active': store.isPolling }"></span>
      <span class="status-bar__text" v-if="store.vehicleCount > 0">
        {{ store.vehicleCount }} bus{{ store.vehicleCount !== 1 ? 'es' : '' }} tracked
      </span>
      <span class="status-bar__text" v-else-if="store.activeLineCount > 0">
        No buses currently running
      </span>
    </div>

    <div class="status-bar__right" v-if="store.error">
      <span class="status-bar__error">{{ store.error }}</span>
    </div>
  </div>
</template>

<style scoped>
.status-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 16px;
  background: var(--panel-bg, #ffffff);
  border-top: 1px solid var(--border-color, #e5e7eb);
  font-size: 13px;
  min-height: 36px;
}

.status-bar__left {
  display: flex;
  align-items: center;
  gap: 8px;
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

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.status-bar__text {
  color: var(--text-secondary, #6b7280);
  font-weight: 500;
}

.status-bar__error {
  color: #ef4444;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 200px;
}
</style>
