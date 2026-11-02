<script setup>
/**
 * LineSelector – bottom sheet (mobile) / sidebar (desktop) for picking lines.
 *
 * Uses window.visualViewport to track the REAL available space when the
 * virtual keyboard pushes things around. This is the only reliable technique
 * on modern mobile browsers (iOS Safari >= 13, Chrome for Android).
 *
 * States:
 *  - resting : compact bar, shows search pill + selected/recent badges
 *  - open    : sheet expanded, anchored ABOVE the keyboard via visualViewport
 */

import { ref, computed, onMounted, onBeforeUnmount, reactive, watch } from 'vue'
import { useBusStore } from '@/store/busStore'
import { ArrowRight, ArrowLeft, ArrowRightLeft, TramFront, Bus, Layers } from 'lucide-vue-next'
import { getLineGroupInfo, groupLines } from '@/utils/lineGroup'
import { parseRoute } from '@/utils/routeGeometry'
import { slotColors } from '@/utils/slotColors'
import LineBadge from '@/components/LineBadge.vue'

const store = useBusStore()
const emit = defineEmits(['sheet-open-change'])

// ---- direction helpers ------------------------------------------------
const DIR_OPTS = [
  { value: 'both',    icon: ArrowRightLeft, title: 'Both directions' },
  { value: 'outward', icon: ArrowRight,     title: 'Outward only' },
  { value: 'return',  icon: ArrowLeft,      title: 'Return only' },
]
function directionOf(lineId) { return store.lineDirectionMap[lineId] || 'both' }
function setDirection(lineId, dir) { store.setLineDirection(lineId, dir) }
function dirIcon(val) {
  return DIR_OPTS.find((o) => o.value === val)?.icon || ArrowRightLeft
}
/** Human label for the active direction, using the API headsigns when loaded. */
function directionLabel(lineId) {
  const dir = directionOf(lineId)
  const route = store.lineRoutes.get(lineId)
  if (!route) return dir === 'both' ? 'Both directions' : 'Loading…'
  const parsed = parseRoute(route)
  if (dir === 'both') {
    const a = parsed.outward?.headsign, b = parsed.return?.headsign
    return a && b ? `${b} ⇄ ${a}` : 'Both directions'
  }
  const headsign = parsed[dir]?.headsign
  return headsign ? `→ ${headsign}` : (dir === 'outward' ? 'Outward' : 'Return')
}
function dirTitle(lineId, opt) {
  if (opt.value === 'both') return opt.title
  const headsign = parseRoute(store.lineRoutes.get(lineId))[opt.value]?.headsign
  return headsign ? `Towards ${headsign}` : opt.title
}
function mapColor(lineId) {
  return slotColors(store.lineSlots[lineId]).outward
}

// ---- sheet state ------------------------------------------------------
const isDesktop   = ref(false)
const isOpen      = ref(false)
const isSearching = ref(false)
const search      = ref('')
const searchEl    = ref(null)
const sheetEl     = ref(null)
const kbOffset    = ref(0)
const vvHeight    = ref(window.innerHeight)

let dragStartY    = 0
let dragStartOpen = false
let isDragging    = false

function onViewportResize() {
  if (window.visualViewport) {
    const gap = window.innerHeight - window.visualViewport.height - window.visualViewport.offsetTop
    kbOffset.value = Math.max(0, Math.round(gap))
    vvHeight.value = Math.round(window.visualViewport.height)
  } else {
    kbOffset.value = 0
    vvHeight.value = window.innerHeight
  }
}

function checkDesktop() {
  const wasDesktop = isDesktop.value
  isDesktop.value = window.innerWidth >= 769
  if (isDesktop.value) isOpen.value = true
  else if (wasDesktop) isOpen.value = false // shrinking to mobile: start collapsed
}

watch([isOpen, isDesktop], ([open, desktop]) => {
  emit('sheet-open-change', !desktop && open)
}, { immediate: true })

onMounted(() => {
  checkDesktop()
  onViewportResize()
  window.addEventListener('resize', checkDesktop)
  window.visualViewport?.addEventListener('resize', onViewportResize)
  window.visualViewport?.addEventListener('scroll', onViewportResize)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', checkDesktop)
  window.visualViewport?.removeEventListener('resize', onViewportResize)
  window.visualViewport?.removeEventListener('scroll', onViewportResize)
})

function openSheet()  { if (!isDesktop.value) isOpen.value = true }
function closeSheet() {
  if (isDesktop.value) return // never close on desktop
  isOpen.value      = false
  isSearching.value = false
  search.value      = ''
  searchEl.value?.blur()
}

function onSearchFocus() { isSearching.value = true; openSheet() }
function onSearchBlur()  { setTimeout(() => { isSearching.value = false }, 200) }
function clearSearch()   { search.value = ''; searchEl.value?.focus() }

// ---- filtering --------------------------------------------------------
const MODE_OPTS = [
  { value: 'all',  label: 'All',  icon: Layers },
  { value: 'tram', label: 'Tram', icon: TramFront },
  { value: 'bus',  label: 'Bus',  icon: Bus },
]
const modeFilter = ref('all')

/** Lowercase + strip accents so "venissieux" finds "Vénissieux". */
function norm(s) {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

const searchIndex = computed(() =>
  store.transitLines.map((line) => {
    const gi = getLineGroupInfo(line)
    return { line, isTram: gi.isTram, haystack: norm(`${line.sName} ${gi.prefix}${gi.number} ${line.lName}`) }
  }),
)

const filteredLines = computed(() => {
  const q = norm(search.value.trim())
  const mode = modeFilter.value
  return searchIndex.value
    .filter((e) => (mode === 'all' || (mode === 'tram') === e.isTram) && (!q || e.haystack.includes(q)))
    .map((e) => e.line)
})

const selectedLines = computed(() =>
  store.selectedIds.map((id) => store.lineMap[id]).filter(Boolean),
)

const recentLines = computed(() => {
  const maxShow = Math.max(0, 4 - selectedLines.value.length)
  return store.recentLineIds
    .filter((id) => !store.selectedLineIds.has(id))
    .map((id) => store.lineMap[id])
    .filter(Boolean)
    .slice(0, maxShow)
})

function parseDestinations(lName) {
  if (!lName) return ['', '']
  const parts = lName.split(' - ')
  return parts.length >= 2
    ? [parts[0].trim(), parts.slice(1).join(' - ').trim()]
    : [lName, '']
}

/** filteredLines grouped by type, each line enriched with parsed destinations */
const filteredGroupedLines = computed(() =>
  groupLines(
    filteredLines.value.map((line) => {
      const [from, to] = parseDestinations(line.lName)
      return { line, id: line.id, _from: from, _to: to }
    }),
    (entry) => entry.line,
  ),
)

function handleToggle(lineId) {
  if (store.maxReached && !store.selectedLineIds.has(lineId)) return
  store.toggleLine(lineId)
}

// ---- drag to open/close (mobile) --------------------------------------
function onDragStart(e) {
  const t = e.touches?.[0] ?? e
  dragStartY    = t.clientY
  dragStartOpen = isOpen.value
  isDragging    = true
}

function onDragMove(e) {
  if (!isDragging || !sheetEl.value) return
  const t  = e.touches?.[0] ?? e
  const dy = Math.max(0, t.clientY - dragStartY)
  if (isOpen.value) {
    sheetEl.value.style.transition = 'none'
    sheetEl.value.style.transform  = `translateY(${dy}px)`
  }
}

function onDragEnd(e) {
  if (!isDragging) return
  isDragging = false
  const t  = e.changedTouches?.[0] ?? e
  const dy = t.clientY - dragStartY
  if (sheetEl.value) {
    sheetEl.value.style.transition = ''
    sheetEl.value.style.transform  = ''
  }
  if (dy < -40 && !dragStartOpen) openSheet()
  if (dy >  60 &&  dragStartOpen) closeSheet()
}

// ---- group collapse ---------------------------------------------------
// Small groups (trams, trambus) are always fully shown; big ones show a
// preview until expanded. While searching, everything that matches is shown.
const GROUP_PREVIEW = 6
const COLLAPSE_THRESHOLD = 10
const expandedGroups = reactive(new Set())
function isCollapsible(group) {
  return !search.value.trim()
    && group.lines.length > COLLAPSE_THRESHOLD
    && !expandedGroups.has(group.key)
}
function canToggleGroup(group) {
  return !search.value.trim() && group.lines.length > COLLAPSE_THRESHOLD
}
function toggleGroup(group) {
  if (!canToggleGroup(group)) return
  if (expandedGroups.has(group.key)) expandedGroups.delete(group.key)
  else expandedGroups.add(group.key)
}
function visibleLines(group) {
  return isCollapsible(group) ? group.lines.slice(0, GROUP_PREVIEW) : group.lines
}
</script>

<template>
  <Transition name="fade">
    <div v-if="isOpen" class="ls-backdrop" @click="closeSheet" />
  </Transition>

  <div
    ref="sheetEl"
    class="ls-sheet"
    :class="{ 'ls-sheet--open': isOpen, 'ls-sheet--kb': kbOffset > 0 }"
    :style="{ '--kb': kbOffset + 'px', '--vvh': vvHeight + 'px' }"
    role="dialog"
    aria-label="Line picker"
    @touchstart.passive="onDragStart"
    @touchmove.passive="onDragMove"
    @touchend.passive="onDragEnd"
  >
    <!-- Handle -->
    <div class="ls-handle"><span class="ls-handle__pill" /></div>

    <!-- Search bar -->
    <div class="ls-search-row">
      <div class="ls-search-box" :class="{ 'ls-search-box--focused': isSearching }">
        <svg class="ls-search-box__icon" width="17" height="17" viewBox="0 0 24 24" fill="none">
          <circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2.2"/>
          <path d="M16.5 16.5l4 4" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
        </svg>
        <input
          ref="searchEl"
          v-model="search"
          type="search"
          class="ls-search-box__input"
          placeholder="Search a line or destination"
          aria-label="Search a bus or tram line"
          enterkeyhint="search"
          autocomplete="off"
          autocorrect="off"
          spellcheck="false"
          @focus="onSearchFocus"
          @blur="onSearchBlur"
        />
        <button v-if="search" class="ls-search-box__clear" aria-label="Clear search" @click.stop="clearSearch" tabindex="-1">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </button>
      </div>
      <button v-if="isOpen" class="ls-cancel-btn" @click="closeSheet">Done</button>
    </div>

    <!-- Resting: badges -->
    <div v-if="!isOpen" class="ls-badges">
      <span v-if="selectedLines.length === 0 && recentLines.length === 0" class="ls-badges__hint">
        Tap to pick a bus or tram line
      </span>
      <button
        v-for="line in selectedLines" :key="'s' + line.id"
        class="ls-badge ls-badge--selected"
        :style="{ '--slot': mapColor(line.id) }"
        :aria-label="'Remove line ' + line.sName"
        @click.stop="handleToggle(line.id)"
      >
        <LineBadge :line="line">
          <component :is="dirIcon(directionOf(line.id))" class="ls-badge__dir" />
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2 6.5l2.5 2.5L10 3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </LineBadge>
      </button>
      <button
        v-for="line in recentLines" :key="'r' + line.id"
        class="ls-badge ls-badge--recent"
        :aria-label="'Show line ' + line.sName"
        @click.stop="handleToggle(line.id)"
      >
        <LineBadge :line="line" />
      </button>
      <span v-if="store.isPolling && store.vehicleCount > 0" class="ls-live-pill">
        <span class="ls-live-pill__dot" />{{ store.vehicleCount }}
      </span>
    </div>

    <!-- Open: mode filter + actions -->
    <div v-if="isOpen" class="ls-actions">
      <div class="ls-mode" role="radiogroup" aria-label="Filter by mode">
        <button
          v-for="opt in MODE_OPTS" :key="opt.value"
          class="ls-mode__btn"
          :class="{ 'ls-mode__btn--active': modeFilter === opt.value }"
          role="radio"
          :aria-checked="modeFilter === opt.value"
          @click="modeFilter = opt.value"
        >
          <component :is="opt.icon" class="ls-mode__icon" />{{ opt.label }}
        </button>
      </div>
      <button v-if="store.activeLineCount > 0" class="ls-actions__clear" @click="store.clearSelection()">
        Clear
      </button>
    </div>

    <!-- Open: direction panel (one row per selected line) -->
    <div v-if="isOpen && selectedLines.length > 0" class="ls-dir-panel">
      <div v-for="line in selectedLines" :key="'dp' + line.id" class="ls-dir-row">
        <span class="ls-dir-row__swatch" :style="{ background: mapColor(line.id) }" title="Color on the map" />
        <LineBadge :line="line" size="sm" />
        <span class="ls-dir-row__label">{{ directionLabel(line.id) }}</span>
        <div class="ls-dir-toggle" role="group" :aria-label="'Direction for line ' + line.sName">
          <button
            v-for="opt in DIR_OPTS" :key="opt.value"
            class="ls-dir-btn"
            :class="{ 'ls-dir-btn--active': directionOf(line.id) === opt.value }"
            :title="dirTitle(line.id, opt)"
            :aria-label="dirTitle(line.id, opt)"
            :aria-pressed="directionOf(line.id) === opt.value"
            @click.stop="setDirection(line.id, opt.value)"
          >
            <component :is="opt.icon" class="ls-dir-btn__icon" />
          </button>
        </div>
      </div>
      <p v-if="store.maxReached" class="ls-dir-panel__hint">
        Up to {{ store.maxLines }} lines at once — remove one to add another.
      </p>
    </div>

    <!-- Open: list -->
    <div v-if="isOpen" class="ls-list-wrap">
      <div v-if="store.isLoadingLines" class="ls-loading">Loading lines…</div>
      <div v-else class="ls-list">
        <template v-for="group in filteredGroupedLines" :key="group.key">
          <div
            class="ls-group-header"
            :class="{ 'ls-group-header--toggle': canToggleGroup(group) }"
            @click="toggleGroup(group)"
          >
            <span>{{ group.label }} <span class="ls-group-count">{{ group.lines.length }}</span></span>
            <svg
              v-if="canToggleGroup(group)"
              class="ls-group-chevron"
              :class="{ 'ls-group-chevron--open': !isCollapsible(group) }"
              width="12" height="12" viewBox="0 0 12 12" fill="none"
            >
              <path d="M2 4l4 4 4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
          <button
            v-for="entry in visibleLines(group)" :key="entry.id"
            class="ls-row"
            :class="{
              'ls-row--on':  store.selectedLineIds.has(entry.id),
              'ls-row--off': store.maxReached && !store.selectedLineIds.has(entry.id),
            }"
            :aria-pressed="store.selectedLineIds.has(entry.id)"
            @click="handleToggle(entry.id)"
          >
            <LineBadge :line="entry.line" />
            <span class="ls-row__name">
              <span class="ls-row__from">{{ entry._from }}</span>
              <span v-if="entry._to" class="ls-row__arrow">→</span>
              <span class="ls-row__to">{{ entry._to }}</span>
            </span>
            <svg v-if="store.selectedLineIds.has(entry.id)" class="ls-row__check" width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M3.5 9.5l4 4L14.5 5" :stroke="mapColor(entry.id)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          <button
            v-if="isCollapsible(group)"
            class="ls-group-more"
            @click.stop="toggleGroup(group)"
          >
            Show all {{ group.lines.length }} lines
          </button>
        </template>
        <p v-if="filteredLines.length === 0 && !store.isLoadingLines" class="ls-empty">
          <template v-if="search">No results for "{{ search }}"</template>
          <template v-else-if="store.error">{{ store.error }}</template>
          <template v-else>No lines</template>
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ls-backdrop {
  position: fixed;
  inset: 0;
  z-index: 999;
  background: rgba(0,0,0,0.25);
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
}
.fade-enter-active, .fade-leave-active { transition: opacity 0.25s ease; }
.fade-enter-from,  .fade-leave-to     { opacity: 0; }

/*
 * KEY: transform: translateY(calc(100% - 140px)) hides all but the top 140px
 * (handle + search + badges). The sheet is always full-height in the DOM,
 * so the list is already rendered and ready — no layout flash on open.
 * bottom: var(--kb) floats the sheet above the virtual keyboard.
 */
.ls-sheet {
  position: fixed;
  left: 0;
  right: 0;
  bottom: var(--kb, 0px);
  z-index: 1000;
  background: #fff;
  border-radius: 20px 20px 0 0;
  box-shadow: 0 -4px 32px rgba(0,0,0,0.14);
  display: flex;
  flex-direction: column;
  max-height: 86dvh;
  transform: translateY(calc(100% - 140px));
  transition: transform 0.32s cubic-bezier(0.32,0.72,0,1), bottom 0.18s ease, max-height 0.18s ease;
  will-change: transform;
  overscroll-behavior: contain;
}
/* White extension below the sheet to cover any gaps (safe area, keyboard transitions) */
.ls-sheet::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: 100%;
  height: 200px;
  background: #fff;
  pointer-events: none;
}
.ls-sheet--open { transform: translateY(0); }
/* When keyboard is open, limit height to visual viewport so search bar stays visible */
.ls-sheet--kb.ls-sheet--open {
  max-height: calc(var(--vvh, 86dvh) - 8px);
}

.ls-handle {
  flex-shrink: 0;
  display: flex;
  justify-content: center;
  padding: 10px 0 6px;
  cursor: grab;
  -webkit-tap-highlight-color: transparent;
}
.ls-handle__pill {
  width: 38px; height: 4px;
  border-radius: 99px;
  background: #d1d5db;
  transition: background 0.2s;
}
.ls-handle:active .ls-handle__pill { background: #9ca3af; }

.ls-search-row {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 14px 10px;
}
.ls-search-box {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 44px;
  padding: 0 14px;
  background: #f2f2f7;
  border-radius: 12px;
  border: 1.5px solid transparent;
  transition: border-color 0.2s, background 0.2s;
}
.ls-search-box--focused { border-color: #007aff; background: #fff; }
.ls-search-box__icon { flex-shrink: 0; color: #8e8e93; }
.ls-search-box__input {
  flex: 1; border: none; background: none; outline: none;
  font-size: 16px; /* 16px prevents iOS auto-zoom */
  color: #1c1c1e; font-family: inherit; min-width: 0;
}
.ls-search-box__input::placeholder { color: #8e8e93; }
.ls-search-box__input::-webkit-search-cancel-button { display: none; }
.ls-search-box__clear {
  flex-shrink: 0; width: 20px; height: 20px; padding: 0;
  border: none; background: #aeaeb2; color: #fff;
  border-radius: 50%; display: flex; align-items: center;
  justify-content: center; cursor: pointer; transition: background 0.15s;
}
.ls-search-box__clear:hover { background: #8e8e93; }
.ls-cancel-btn {
  flex-shrink: 0; border: none; background: none;
  color: #007aff; font-size: 15px; font-weight: 600;
  padding: 0 4px; cursor: pointer; font-family: inherit;
  white-space: nowrap; -webkit-tap-highlight-color: transparent;
}

/* ---- Resting badges -------------------------------------------- */
.ls-badges {
  flex-shrink: 0;
  display: flex; align-items: center; flex-wrap: wrap;
  gap: 8px; padding: 0 14px 14px;
}
.ls-badges__hint { font-size: 13px; color: #8e8e93; }
.ls-badge {
  display: inline-flex;
  padding: 0;
  border: none;
  border-radius: 99px;
  background: none;
  cursor: pointer;
  font-family: inherit;
  -webkit-tap-highlight-color: transparent;
  transition: opacity 0.15s, transform 0.1s;
}
.ls-badge:active { transform: scale(0.93); }
/* Selected: ring in the line's map color */
.ls-badge--selected {
  box-shadow: 0 0 0 2px #fff, 0 0 0 4px var(--slot, rgba(0,0,0,0.18));
}
.ls-badge--recent { opacity: 0.6; }
.ls-badge--recent:hover { opacity: 1; }
.ls-badge__dir {
  width: 13px;
  height: 13px;
  flex-shrink: 0;
  stroke-width: 2.5;
}
.ls-live-pill {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 5px 10px; background: #f2f2f7; border-radius: 99px;
  font-size: 12px; font-weight: 600; color: #3a3a3c; margin-left: auto;
  white-space: nowrap;
}
.ls-live-pill__dot {
  width: 7px; height: 7px; border-radius: 50%; background: #34c759;
  animation: dot-pulse 2s ease infinite;
}
@keyframes dot-pulse {
  0%, 100% { opacity: 1; } 50% { opacity: 0.4; }
}

/* ---- Actions row (mode filter) ---------------------------------- */
.ls-actions {
  flex-shrink: 0;
  display: flex; align-items: center; gap: 8px;
  padding: 0 14px 10px;
  border-bottom: 1px solid #f2f2f7;
}
.ls-mode {
  display: flex;
  background: #f2f2f7;
  border-radius: 10px;
  padding: 3px;
  gap: 2px;
}
.ls-mode__btn {
  display: inline-flex; align-items: center; gap: 5px;
  height: 30px; padding: 0 11px;
  border: none; border-radius: 8px; background: none;
  color: #6b7280; font-size: 13px; font-weight: 600;
  font-family: inherit; cursor: pointer;
  transition: background 0.15s, color 0.15s;
  -webkit-tap-highlight-color: transparent;
}
.ls-mode__btn:hover { color: #1c1c1e; }
.ls-mode__btn--active {
  background: #fff; color: #1c1c1e;
  box-shadow: 0 1px 4px rgba(0,0,0,0.12);
}
.ls-mode__icon { width: 15px; height: 15px; stroke-width: 2.2; }
.ls-actions__clear {
  padding: 7px 14px; border: none; border-radius: 10px;
  background: #fef2f2; color: #dc2626; font-size: 13px; font-weight: 600;
  cursor: pointer; font-family: inherit; transition: background 0.15s;
}
.ls-actions__clear:hover { background: #fee2e2; }

/* ---- List ------------------------------------------------------- */
.ls-list-wrap {
  flex: 1; overflow-y: auto; overflow-x: hidden;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior-y: contain;
}
.ls-list { padding-bottom: 24px; }
.ls-loading, .ls-empty {
  padding: 32px 16px; text-align: center; font-size: 14px; color: #8e8e93;
}
.ls-group-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px 4px;
  font-size: 11px;
  font-weight: 700;
  color: #8e8e93;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  position: sticky;
  top: 0;
  background: #fff;
  z-index: 1;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
}
.ls-group-header--toggle { cursor: pointer; }
.ls-group-count {
  margin-left: 4px;
  color: #c7c7cc;
  font-weight: 600;
}
.ls-group-chevron {
  color: #c7c7cc;
  transition: transform 0.22s ease;
  flex-shrink: 0;
}
.ls-group-chevron--open { transform: rotate(180deg); }
.ls-group-more {
  display: block;
  width: 100%;
  padding: 8px 16px 12px 16px;
  border: none;
  background: none;
  text-align: left;
  color: #007aff;
  font-size: 13px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.ls-group-more:hover { text-decoration: underline; }

.ls-row {
  display: flex; align-items: center; gap: 12px;
  width: 100%; padding: 9px 16px;
  border: none; background: none; cursor: pointer;
  text-align: left; font-family: inherit;
  -webkit-tap-highlight-color: transparent;
  transition: background 0.1s;
}
.ls-row:hover   { background: #fafafa; }
.ls-row:active  { background: #f2f2f7; }
.ls-row--on     { background: #fff1f2; }
.ls-row--on:hover { background: #ffe4e6; }
.ls-row--off    { opacity: 0.32; pointer-events: none; }

.ls-row__name {
  flex: 1; min-width: 0; display: flex; align-items: center;
  gap: 5px; font-size: 13px; color: #3a3a3c;
}
.ls-row__from {
  font-weight: 600; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; min-width: 0; flex-shrink: 1;
}
.ls-row__to {
  color: #8e8e93; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; min-width: 0; flex-shrink: 1;
}
.ls-row__arrow { flex-shrink: 0; color: #c7c7cc; font-size: 12px; }
.ls-row__check { flex-shrink: 0; }

/* ---- Direction panel -------------------------------------------- */
.ls-dir-panel {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 14px 10px;
  border-bottom: 1px solid #f2f2f7;
}
.ls-dir-panel__hint {
  font-size: 12px;
  color: #8e8e93;
  padding-top: 2px;
}
.ls-dir-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ls-dir-row__swatch {
  flex-shrink: 0;
  width: 4px;
  height: 24px;
  border-radius: 99px;
}
.ls-dir-row__label {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  font-weight: 500;
  color: #6b7280;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ls-dir-toggle {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  background: #f2f2f7;
  border-radius: 9px;
  padding: 3px;
  gap: 2px;
}
.ls-dir-btn {
  padding: 5px 8px;
  border: none;
  background: none;
  border-radius: 7px;
  color: #6b7280;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.15s, color 0.15s;
  white-space: nowrap;
  -webkit-tap-highlight-color: transparent;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 32px;
  height: 32px;
}
.ls-dir-btn:hover { background: rgba(0,0,0,0.06); color: #1c1c1e; }
.ls-dir-btn--active {
  background: #fff;
  color: #1c1c1e;
  box-shadow: 0 1px 4px rgba(0,0,0,0.12);
}
.ls-dir-btn__icon {
  width: 18px;
  height: 18px;
  stroke-width: 2;
}

/* Desktop: static sidebar, no sheet behavior */
@media (min-width: 769px) {
  .ls-backdrop { display: none; }
  .ls-sheet {
    position: absolute !important;
    top: 16px; left: 16px; right: auto;
    width: 360px; max-height: none;
    transform: none !important;
    bottom: 16px !important;
    border-radius: 16px;
    box-shadow: 0 4px 24px rgba(0,0,0,0.12);
    overflow: hidden;
  }
  .ls-sheet::after { display: none; }
  .ls-search-row { padding-top: 14px; }
  .ls-handle    { display: none; }
  .ls-cancel-btn { display: none; }
}
</style>
