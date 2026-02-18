<script setup>
/**
 * LineSelector - iOS Maps-style bottom drawer for bus line selection.
 *
 * Collapsed state: Search bar + selected/recent line badges
 * Expanded state: Full scrollable list
 * Auto-expands when search is focused to show results above keyboard
 */

import { ref, computed, watch, nextTick } from 'vue'
import { useBusStore } from '@/store/busStore'

const props = defineProps({
  isExpanded: { type: Boolean, default: false },
})

const emit = defineEmits(['update:expanded'])

const store = useBusStore()
const search = ref('')
const searchInput = ref(null)

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
 * Get currently selected lines for display in compact mode
 */
const selectedLines = computed(() => {
  return store.selectedIds
    .map(id => store.lineMap[id])
    .filter(Boolean)
})

/**
 * Get recent lines (not currently selected) for display in compact mode
 */
const recentLines = computed(() => {
  if (selectedLines.value.length >= 3) return []
  
  return store.recentLineIds
    .filter(id => !store.selectedLineIds.has(id))
    .map(id => store.lineMap[id])
    .filter(Boolean)
    .slice(0, 3 - selectedLines.value.length)
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

/**
 * Auto-expand when search input is focused
 */
function onSearchFocus() {
  emit('update:expanded', true)
}

/**
 * Collapse when clicking outside search while nothing typed
 */
function onSearchBlur() {
  if (!search.value.trim()) {
    // Delay to allow click events to fire
    setTimeout(() => {
      if (!search.value.trim()) {
        emit('update:expanded', false)
      }
    }, 150)
  }
}

/**
 * Quick select from compact view
 */
function quickSelect(lineId) {
  handleToggle(lineId)
}

/**
 * Clear search and collapse
 */
function clearSearch() {
  search.value = ''
  searchInput.value?.blur()
  emit('update:expanded', false)
}
</script>

<template>
  <div class="drawer">
    <!-- Compact bar (always visible) -->
    <div class="drawer__compact">
      <!-- Search bar -->
      <div class="drawer__search-wrap" @click="onSearchFocus">
        <svg class="drawer__search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none">
          <circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2"/>
          <path d="M16 16l4.5 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
        <input
          ref="searchInput"
          v-model="search"
          type="search"
          class="drawer__search"
          placeholder="Search bus lines..."
          autocomplete="off"
          @focus="onSearchFocus"
          @blur="onSearchBlur"
        />
        <button
          v-if="isExpanded && search"
          class="drawer__clear-search"
          @click.stop="clearSearch"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M12 4L4 12M4 4l8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </button>
      </div>

      <!-- Selected + Recent lines (compact view only) -->
      <div v-if="!isExpanded" class="drawer__quick-lines">
        <!-- Selected lines -->
        <button
          v-for="line in selectedLines"
          :key="'sel-' + line.id"
          class="quick-line quick-line--active"
          :style="{ background: '#' + line.color, color: '#' + line.textColor }"
          @click="quickSelect(line.id)"
        >
          <span class="quick-line__badge">{{ line.sName }}</span>
          <svg class="quick-line__check" width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M3 8.5l3.5 3.5L13 4" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>

        <!-- Recent lines -->
        <button
          v-for="line in recentLines"
          :key="'rec-' + line.id"
          class="quick-line"
          :style="{ background: '#' + line.color, color: '#' + line.textColor }"
          @click="quickSelect(line.id)"
        >
          <span class="quick-line__badge">{{ line.sName }}</span>
        </button>

        <!-- Status indicator -->
        <div v-if="store.isPolling && store.vehicleCount > 0" class="drawer__status-mini">
          <span class="drawer__status-dot"></span>
          <span>{{ store.vehicleCount }}</span>
        </div>
      </div>

      <!-- Actions in expanded mode -->
      <div v-if="isExpanded" class="drawer__actions">
        <button
          class="drawer__select-all"
          :disabled="store.maxReached"
          @click="store.selectAll()"
        >
          Select {{ store.maxLines }} lines
        </button>
        <button
          v-if="store.activeLineCount > 0"
          class="drawer__clear"
          @click="store.clearSelection()"
        >
          Clear all
        </button>
        <span v-if="store.isPolling && store.vehicleCount > 0" class="drawer__vehicle-count">
          <span class="drawer__status-dot"></span>
          {{ store.vehicleCount }} bus{{ store.vehicleCount !== 1 ? 'es' : '' }}
        </span>
      </div>
    </div>

    <!-- Expanded list (shown when expanded) -->
    <div v-if="isExpanded" class="drawer__list-container">
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
  </div>
</template>

<style scoped>
.drawer {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

/* -- Compact bar (always visible) -- */
.drawer__compact {
  flex-shrink: 0;
  padding: 12px 16px;
  background: #ffffff;
}

/* -- Search -- */
.drawer__search-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 14px;
  height: 44px;
  background: #f4f4f5;
  border-radius: 12px;
  cursor: text;
  transition: background 0.2s;
}

.drawer__search-wrap:focus-within {
  background: #e5e7eb;
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

.drawer__clear-search {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  background: #d1d5db;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: #fff;
  transition: background 0.2s;
}

.drawer__clear-search:hover {
  background: #9ca3af;
}

/* -- Quick lines (compact view) -- */
.drawer__quick-lines {
  display: flex;
  gap: 8px;
  margin-top: 12px;
  flex-wrap: wrap;
  align-items: center;
}

.quick-line {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: none;
  border-radius: 20px;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  transition: opacity 0.2s, transform 0.1s;
  font-family: inherit;
  -webkit-tap-highlight-color: transparent;
}

.quick-line:active {
  transform: scale(0.95);
}

.quick-line__badge {
  letter-spacing: 0.01em;
}

.quick-line__check {
  flex-shrink: 0;
  stroke-width: 2.5;
}

.quick-line--active {
  box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.15);
}

.drawer__status-mini {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  padding: 6px 12px;
  background: #f4f4f5;
  border-radius: 20px;
  font-size: 13px;
  font-weight: 600;
  color: #6b7280;
}

.drawer__status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #10b981;
  animation: pulse 2s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

/* -- Actions (expanded mode) -- */
.drawer__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  flex-wrap: wrap;
}

.drawer__select-all {
  border: 1.5px solid #e5e7eb;
  background: #fff;
  color: #374151;
  font-size: 12px;
  font-weight: 600;
  padding: 6px 12px;
  border-radius: 8px;
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

.drawer__clear {
  border: none;
  background: #c62828;
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  padding: 6px 12px;
  border-radius: 8px;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.15s;
}

.drawer__clear:hover {
  background: #b71c1c;
}

.drawer__vehicle-count {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #6b7280;
  font-weight: 500;
  margin-left: auto;
}

/* -- List container (expanded mode) -- */
.drawer__list-container {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 0;
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
  padding: 0 0 16px;
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
  -webkit-tap-highlight-color: transparent;
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

/* Desktop adjustments */
@media (min-width: 769px) {
  .drawer__compact {
    padding: 16px;
  }
}
</style>
