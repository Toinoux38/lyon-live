<script setup>
/**
 * LineSelector  bottom sheet for bus line selection.
 *
 * Uses window.visualViewport to track the REAL available space when the
 * virtual keyboard pushes things around. This is the only reliable technique
 * on modern mobile browsers (iOS Safari >= 13, Chrome for Android).
 *
 * States:
 *  - resting   : compact bar, ~96px, shows search pill + recent/selected badges
 *  - open      : sheet expanded, anchored ABOVE the keyboard via visualViewport
 */

import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useBusStore } from '@/store/busStore'

const store = useBusStore()

const isDesktop   = ref(false)
const isOpen      = ref(false)
const isSearching = ref(false)
const search      = ref('')
const searchEl    = ref(null)
const sheetEl     = ref(null)
const kbOffset    = ref(0)

let dragStartY    = 0
let dragStartOpen = false
let isDragging    = false

function onViewportResize() {
  if (!window.visualViewport) return
  const gap = window.innerHeight - window.visualViewport.height - window.visualViewport.offsetTop
  kbOffset.value = Math.max(0, Math.round(gap))
}

function checkDesktop() {
  isDesktop.value = window.innerWidth >= 769
  if (isDesktop.value) isOpen.value = true
}

onMounted(() => {
  checkDesktop()
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
  if (isDesktop.value) return  // never close on desktop
  isOpen.value      = false
  isSearching.value = false
  search.value      = ''
  searchEl.value?.blur()
}

function onSearchFocus() { isSearching.value = true;  openSheet() }
function onSearchBlur()  { setTimeout(() => { isSearching.value = false }, 200) }
function clearSearch()   { search.value = ''; searchEl.value?.focus() }

const filteredLines = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return store.busLines
  return store.busLines.filter(
    l => (l.sName?.toLowerCase().includes(q)) || (l.lName?.toLowerCase().includes(q))
  )
})

const selectedLines = computed(() =>
  store.selectedIds.map(id => store.lineMap[id]).filter(Boolean)
)

const recentLines = computed(() => {
  const maxShow = Math.max(0, 4 - selectedLines.value.length)
  return store.recentLineIds
    .filter(id => !store.selectedLineIds.has(id))
    .map(id => store.lineMap[id])
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

function handleToggle(lineId) {
  if (store.maxReached && !store.selectedLineIds.has(lineId)) return
  store.toggleLine(lineId)
}

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
</script>

<template>
  <Transition name="fade">
    <div v-if="isOpen" class="ls-backdrop" @click="closeSheet" />
  </Transition>

  <div
    ref="sheetEl"
    class="ls-sheet"
    :class="{ 'ls-sheet--open': isOpen }"
    :style="{ '--kb': kbOffset + 'px' }"
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
          placeholder="Search a line"
          enterkeyhint="search"
          autocomplete="off"
          autocorrect="off"
          spellcheck="false"
          @focus="onSearchFocus"
          @blur="onSearchBlur"
        />
        <button v-if="search" class="ls-search-box__clear" @click.stop="clearSearch" tabindex="-1">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </button>
      </div>
      <button v-if="isOpen" class="ls-cancel-btn" @click="closeSheet">Cancel</button>
    </div>

    <!-- Resting: badges -->
    <div v-if="!isOpen" class="ls-badges">
      <template v-if="selectedLines.length === 0 && recentLines.length === 0">
        <span class="ls-badges__hint">Tap to pick a bus line</span>
      </template>
      <button
        v-for="line in selectedLines" :key="'s' + line.id"
        class="ls-badge ls-badge--selected"
        :style="{ '--c': '#' + line.color, '--tc': '#' + line.textColor }"
        @click.stop="handleToggle(line.id)"
      >
        <span>{{ line.sName }}</span>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M2 6.5l2.5 2.5L10 3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      <button
        v-for="line in recentLines" :key="'r' + line.id"
        class="ls-badge ls-badge--recent"
        :style="{ '--c': '#' + line.color, '--tc': '#' + line.textColor }"
        @click.stop="handleToggle(line.id)"
      >{{ line.sName }}</button>
      <span v-if="store.isPolling && store.vehicleCount > 0" class="ls-live-pill">
        <span class="ls-live-pill__dot" />{{ store.vehicleCount }}
      </span>
    </div>

    <!-- Open: actions -->
    <div v-if="isOpen" class="ls-actions">
      <button class="ls-actions__select" :disabled="store.maxReached" @click="store.selectAll()">
        Select top {{ store.maxLines }}
      </button>
      <button v-if="store.activeLineCount > 0" class="ls-actions__clear" @click="store.clearSelection()">
        Clear
      </button>
      <span v-if="store.isPolling && store.vehicleCount > 0" class="ls-live-pill ls-live-pill--sm">
        <span class="ls-live-pill__dot" />{{ store.vehicleCount }} live
      </span>
    </div>

    <!-- Open: list -->
    <div v-if="isOpen" class="ls-list-wrap">
      <div v-if="store.isLoadingLines" class="ls-loading">Loading lines</div>
      <div v-else class="ls-list">
        <button
          v-for="line in filteredLines" :key="line.id"
          class="ls-row"
          :class="{
            'ls-row--on':  store.selectedLineIds.has(line.id),
            'ls-row--off': store.maxReached && !store.selectedLineIds.has(line.id),
          }"
          @click="handleToggle(line.id)"
        >
          <span class="ls-row__badge" :style="{ background: '#' + line.color, color: '#' + line.textColor }">
            {{ line.sName }}
          </span>
          <span class="ls-row__name">
            <span class="ls-row__from">{{ parseDestinations(line.lName)[0] }}</span>
            <span class="ls-row__arrow"></span>
            <span class="ls-row__to">{{ parseDestinations(line.lName)[1] }}</span>
          </span>
          <svg v-if="store.selectedLineIds.has(line.id)" class="ls-row__check" width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path d="M3.5 9.5l4 4L14.5 5" stroke="#DC2626" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <p v-if="filteredLines.length === 0 && search" class="ls-empty">
          No results for "{{ search }}"
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
 * KEY: transform: translateY(calc(100% - 96px)) hides all but the top 96px
 * (handle + search + badges). The sheet is always full-height in the DOM,
 * so the list is already rendered and ready  no layout flash on open.
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
  transform: translateY(calc(100% - 96px));
  transition: transform 0.32s cubic-bezier(0.32,0.72,0,1), bottom 0.18s ease;
  will-change: transform;
  overscroll-behavior: contain;
}
.ls-sheet--open { transform: translateY(0); }

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
  color: #007aff; font-size: 15px; font-weight: 500;
  padding: 0 4px; cursor: pointer; font-family: inherit;
  white-space: nowrap; -webkit-tap-highlight-color: transparent;
}

.ls-badges {
  flex-shrink: 0;
  display: flex; align-items: center; flex-wrap: wrap;
  gap: 8px; padding: 0 14px 14px;
}
.ls-badges__hint { font-size: 13px; color: #8e8e93; }
.ls-badge {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 6px 13px; border: none; border-radius: 99px;
  font-size: 13px; font-weight: 700; cursor: pointer;
  font-family: inherit; -webkit-tap-highlight-color: transparent;
  transition: opacity 0.15s, transform 0.1s;
}
.ls-badge:active { transform: scale(0.93); }
.ls-badge--selected {
  background: var(--c); color: var(--tc);
  box-shadow: 0 0 0 2.5px rgba(0,0,0,0.12);
}
.ls-badge--recent {
  background: color-mix(in srgb, var(--c) 14%, #f2f2f7);
  color: color-mix(in srgb, var(--c) 75%, #1c1c1e);
  border: 1.5px solid color-mix(in srgb, var(--c) 28%, transparent);
}
.ls-live-pill {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 5px 10px; background: #f2f2f7; border-radius: 99px;
  font-size: 12px; font-weight: 600; color: #3a3a3c; margin-left: auto;
}
.ls-live-pill--sm { margin-left: auto; }
.ls-live-pill__dot {
  width: 7px; height: 7px; border-radius: 50%; background: #34c759;
  animation: dot-pulse 2s ease infinite;
}
@keyframes dot-pulse {
  0%, 100% { opacity: 1; } 50% { opacity: 0.4; }
}

.ls-actions {
  flex-shrink: 0;
  display: flex; align-items: center; gap: 8px;
  padding: 0 14px 10px;
  border-bottom: 1px solid #f2f2f7;
}
.ls-actions__select {
  padding: 7px 14px; border: 1.5px solid #e5e7eb; border-radius: 10px;
  background: #fff; color: #3a3a3c; font-size: 13px; font-weight: 600;
  cursor: pointer; font-family: inherit; transition: background 0.15s;
}
.ls-actions__select:hover { background: #f2f2f7; }
.ls-actions__select:disabled { opacity: 0.35; cursor: default; }
.ls-actions__clear {
  padding: 7px 14px; border: none; border-radius: 10px;
  background: #fef2f2; color: #dc2626; font-size: 13px; font-weight: 600;
  cursor: pointer; font-family: inherit; transition: background 0.15s;
}
.ls-actions__clear:hover { background: #fee2e2; }

.ls-list-wrap {
  flex: 1; overflow-y: auto; overflow-x: hidden;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior-y: contain;
}
.ls-list { padding-bottom: 24px; }
.ls-loading, .ls-empty {
  padding: 32px 16px; text-align: center; font-size: 14px; color: #8e8e93;
}

.ls-row {
  display: flex; align-items: center; gap: 12px;
  width: 100%; padding: 11px 16px;
  border: none; background: none; cursor: pointer;
  text-align: left; font-family: inherit;
  -webkit-tap-highlight-color: transparent;
  transition: background 0.1s;
}
.ls-row:active  { background: #f2f2f7; }
.ls-row--on     { background: #fff1f2; }
.ls-row--on:active { background: #fee2e2; }
.ls-row--off    { opacity: 0.32; pointer-events: none; }

.ls-row__badge {
  flex-shrink: 0; display: inline-flex; align-items: center;
  justify-content: center; min-width: 48px; height: 32px;
  padding: 0 8px; border-radius: 7px; font-size: 13px;
  font-weight: 800; letter-spacing: 0.02em; white-space: nowrap;
}
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
  }
  .ls-handle    { display: none; }
  .ls-cancel-btn { display: none; }
}
</style>
