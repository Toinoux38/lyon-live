<script setup>
/**
 * LineSelector - Bottom-drawer panel for browsing and selecting bus lines.
 *
 * Mobile-first design: a card that sits at the bottom of the screen.
 * Contains a search bar and a scrollable list of lines showing
 * the line badge + destinations (e.g. "Montessuy <> Grange Blanche").
 */

import { ref, computed } from 'vue'
import { useBusStore } from '@/store/busStore'

const store = useBusStore()
const search = ref('')

const filteredLines = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return store.busLines
  return store.busLines.filter(
    (l) =>
      (l.sName && l.sName.toLowerCase().includes(q)) ||
      (l.lName && l.lName.toLowerCase().includes(q)),
  )
})

/**
 * Parse the lName field ("Grange Blanche - Montessuy") into two endpoints.
 */
function parseDestinations(lName) {
  if (!lName) return ['', '']
  const parts = lName.split(' - ')
  if (parts.length >= 2) {
    return [parts[0].trim(), parts.slice(1).join(' - ').trim()]
  }
  return [lName, '']
}

function handleToggle(lineId) {
  // Don't allow selecting more if max reached (unless deselecting)
  if (store.maxReached && !store.selectedLineIds.has(lineId)) return
  store.toggleLine(lineId)
}
</script>

<template>
  <div class="drawer">
    <!-- Drag handle -->
    <div class="drawer__handle-bar">
      <div class="drawer__handle"></div>
    </div>

    <!-- Search -->
    <div class="drawer__search-wrap">
      <svg class="drawer__search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none">
        <circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2"/>
        <path d="M16 16l4.5 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>
      <input
        v-model="search"
        type="search"
        class="drawer__search"
        placeholder="Search a bus line..."
        autocomplete="off"
      />
      <button
        v-if="store.activeLineCount > 0"
        class="drawer__clear"
        @click="store.clearSelection()"
      >
        Clear ({{ store.activeLineCount }})
      </button>
    </div>

    <!-- Actions -->
    <div class="drawer__actions">
      <button
        class="drawer__select-all"
        :disabled="store.maxReached"
        @click="store.selectAll()"
      >
        Select {{ store.maxLines }} lines
      </button>
      <span v-if="store.maxReached && store.activeLineCount > 0" class="drawer__limit-hint">
        Max {{ store.maxLines }} lines
      </span>
      <span class="drawer__vehicle-count" v-if="store.isPolling && store.vehicleCount > 0">
        <span class="drawer__status-dot"></span>
        {{ store.vehicleCount }} bus{{ store.vehicleCount !== 1 ? 'es' : '' }} live
      </span>
    </div>

    <!-- Status (legacy fallback) -->
    <div class="drawer__status" v-if="!store.isPolling && store.activeLineCount > 0 && store.vehicleCount === 0">
      <span class="drawer__status-dot"></span>
      {{ store.vehicleCount }} bus{{ store.vehicleCount !== 1 ? 'es' : '' }} live
    </div>

    <!-- Loading -->
    <div class="drawer__loading" v-if="store.isLoadingLines">
      Loading lines...
    </div>

    <!-- Line list -->
    <div class="drawer__list" v-else>
      <button
        v-for="line in filteredLines"
        :key="line.id"
        class="line-row"
        :class="{
          'line-row--active': store.selectedLineIds.has(line.id),
          'line-row--disabled': store.maxReached && !store.selectedLineIds.has(line.id),
        }"
        @click="handleToggle(line.id)"
      >
        <span
          class="line-row__badge"
          :style="{ background: '#' + line.color, color: '#' + line.textColor }"
        >
          {{ line.sName }}
        </span>

        <span class="line-row__destinations">
          <span class="line-row__from">{{ parseDestinations(line.lName)[0] }}</span>
          <span class="line-row__separator">
            <svg width="14" height="10" viewBox="0 0 14 10" fill="none">
              <path d="M0 5h14M10 1l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <svg width="14" height="10" viewBox="0 0 14 10" fill="none" style="transform: scaleX(-1);">
              <path d="M0 5h14M10 1l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </span>
          <span class="line-row__to">{{ parseDestinations(line.lName)[1] }}</span>
        </span>

        <span class="line-row__check" v-if="store.selectedLineIds.has(line.id)">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M3 8.5l3.5 3.5L13 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </span>
      </button>

      <p v-if="filteredLines.length === 0 && search" class="drawer__empty">
        No lines matching "{{ search }}"
      </p>
    </div>
  </div>
</template>

<style scoped>
.drawer {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #ffffff;
  overflow: hidden;
}

/* -- Handle -- */
.drawer__handle-bar {
  display: flex;
  justify-content: center;
  padding: 10px 0 4px;
  flex-shrink: 0;
}

.drawer__handle {
  width: 36px;
  height: 4px;
  border-radius: 2px;
  background: #d1d5db;
}

/* -- Search -- */
.drawer__search-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px 16px 0;
  padding: 0 14px;
  height: 44px;
  background: #f4f4f5;
  border-radius: 12px;
  flex-shrink: 0;
}

.drawer__search-icon {
  flex-shrink: 0;
  color: #9ca3af;
}

.drawer__search {
  flex: 1;
  border: none;
  background: none;
  outline: none;
  font-size: 15px;
  color: #1a1a1a;
  font-family: inherit;
}

.drawer__search::placeholder {
  color: #9ca3af;
}

.drawer__clear {
  flex-shrink: 0;
  border: none;
  background: #c62828;
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: 6px;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.15s;
}

.drawer__clear:hover {
  background: #b71c1c;
}

/* -- Status -- */
.drawer__actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px 0;
  flex-shrink: 0;
}

.drawer__select-all {
  border: 1.5px solid #e5e7eb;
  background: #fff;
  color: #374151;
  font-size: 12px;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: 6px;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.15s, border-color 0.15s;
}

.drawer__select-all:hover {
  background: #f4f4f5;
  border-color: #d1d5db;
}

.drawer__select-all:disabled {
  opacity: 0.4;
  cursor: default;
}

.drawer__vehicle-count {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #6b7280;
  font-weight: 500;
}

.drawer__limit-hint {
  font-size: 11px;
  color: #c62828;
  font-weight: 600;
}

.drawer__status {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px 0;
  font-size: 12px;
  color: #6b7280;
  font-weight: 500;
  flex-shrink: 0;
}

.drawer__status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #c62828;
  animation: pulse-red 2s ease-in-out infinite;
}

@keyframes pulse-red {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

/* -- Loading -- */
.drawer__loading {
  padding: 24px 16px;
  text-align: center;
  font-size: 14px;
  color: #9ca3af;
}

/* -- List -- */
.drawer__list {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0 16px;
  -webkit-overflow-scrolling: touch;
}

.drawer__empty {
  text-align: center;
  padding: 24px 16px;
  font-size: 14px;
  color: #9ca3af;
}

/* -- Line Row -- */
.line-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 10px 16px;
  border: none;
  background: none;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  transition: background 0.12s;
}

.line-row:hover {
  background: #fafafa;
}

.line-row--active {
  background: #fef2f2;
}

.line-row--active:hover {
  background: #fee2e2;
}

.line-row--disabled {
  opacity: 0.35;
  cursor: not-allowed;
  pointer-events: none;
}

.line-row__badge {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 46px;
  height: 30px;
  padding: 0 8px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.02em;
  flex-shrink: 0;
  white-space: nowrap;
}

.line-row__destinations {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: 13px;
  color: #374151;
  line-height: 1.3;
}

.line-row__from,
.line-row__to {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.line-row__from {
  flex-shrink: 1;
  min-width: 0;
  font-weight: 600;
}

.line-row__to {
  flex-shrink: 1;
  min-width: 0;
  color: #6b7280;
}

.line-row__separator {
  flex-shrink: 0;
  display: flex;
  gap: 1px;
  color: #d1d5db;
}

.line-row__check {
  flex-shrink: 0;
  color: #c62828;
  display: flex;
  align-items: center;
}
</style>
