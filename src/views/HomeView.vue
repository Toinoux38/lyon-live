<script setup>
/**
 * HomeView - Main page.
 *
 * Layout: Full-screen map with a bottom drawer card for line selection.
 * The drawer has three states:
 *   - collapsed: only search bar visible (~110px)
 *   - half: scrollable list (~55% of screen)
 *   - full: nearly full screen (~90%)
 * Swipe or tap the handle to toggle between states.
 */

import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useBusStore } from '@/store/busStore'
import MapView from '@/components/MapView.vue'
import BusMarkerLayer from '@/components/BusMarkerLayer.vue'
import LineRoute from '@/components/LineRoute.vue'
import LineSelector from '@/components/LineSelector.vue'

const store = useBusStore()

/**
 * 3 fixed slot colors for selected lines.
 * Each has outward (main) and return (lighter variant) colors.
 */
const SLOT_COLORS = [
  { main: '#DC2626', outward: '#DC2626', return: '#F87171' },  // bright red
  { main: '#1E3A5F', outward: '#1E3A5F', return: '#60A5FA' },  // dark blue / light blue
  { main: '#374151', outward: '#374151', return: '#9CA3AF' },  // dark gray / medium gray
]

/**
 * Map each selected line to a color slot (by selection order).
 */
const lineColorSlots = computed(() => {
  const map = {}
  store.selectedIds.forEach((id, idx) => {
    map[id] = SLOT_COLORS[idx] || SLOT_COLORS[0]
  })
  return map
})

/** Drawer state: 'collapsed' | 'half' | 'full' */
const drawerState = ref('collapsed')

const drawerTransform = computed(() => {
  const vh = window.innerHeight
  switch (drawerState.value) {
    case 'full': return `translateY(calc(15vh))`
    case 'half': return `translateY(calc(50vh))`
    default: return `translateY(calc(100vh - 120px))`
  }
})

function cycleDrawer() {
  const order = ['collapsed', 'half', 'full']
  const idx = order.indexOf(drawerState.value)
  drawerState.value = order[(idx + 1) % order.length]
}

/** Touch-drag logic for the drawer handle */
let touchStartY = 0
let touchStartHeight = 0

function onTouchStart(e) {
  touchStartY = e.touches[0].clientY
  const vh = window.innerHeight
  switch (drawerState.value) {
    case 'full': touchStartHeight = vh * 0.85; break
    case 'half': touchStartHeight = vh * 0.5; break
    default: touchStartHeight = 120; break
  }
}

function onTouchEnd(e) {
  const dy = touchStartY - e.changedTouches[0].clientY
  const vh = window.innerHeight

  if (dy > 40) {
    // Swiped up (reduced threshold for better responsiveness)
    if (drawerState.value === 'collapsed') drawerState.value = 'half'
    else if (drawerState.value === 'half') drawerState.value = 'full'
  } else if (dy < -40) {
    // Swiped down (reduced threshold for better responsiveness)
    if (drawerState.value === 'full') drawerState.value = 'half'
    else if (drawerState.value === 'half') drawerState.value = 'collapsed'
  }
}

/**
 * Enrich vehicles with line color and name.
 */
const enrichedVehicles = computed(() => {
  return store.vehicles.map((v) => {
    let matchedLine = null
    let matchedLineId = null
    for (const lineId of store.selectedIds) {
      const line = store.lineMap[lineId]
      if (!line) continue
      const code = line.sName
      if (code && v.id && v.id.includes(code)) {
        matchedLine = line
        matchedLineId = lineId
        break
      }
    }
    if (!matchedLine && store.selectedIds.length > 0) {
      matchedLineId = store.selectedIds[0]
      matchedLine = store.lineMap[matchedLineId]
    }
    // Use slot color based on direction
    const slot = lineColorSlots.value[matchedLineId] || SLOT_COLORS[0]
    const slotColor = v.direction === 'return' ? slot.return : slot.outward
    return {
      ...v,
      lineColor: slotColor.replace('#', ''),
      lineName: matchedLine?.sName || '?',
    }
  })
})

/**
 * Prepared route data for rendering on the map.
 */
const routeLayers = computed(() => {
  return store.activeRoutes.map((r) => {
    const slot = lineColorSlots.value[r.lineId] || SLOT_COLORS[0]
    return {
      lineId: r.lineId,
      data: r.data,
      outwardColor: slot.outward,
      returnColor: slot.return,
    }
  })
})

onMounted(() => {
  store.loadLines()
})

onBeforeUnmount(() => {
  store.stopPolling()
})

watch(
  () => store.activeLineCount,
  (count) => {
    if (count > 0) {
      store.startPolling()
    } else {
      store.stopPolling()
    }
  },
)
</script>

<template>
  <div class="home">
    <!-- Map (full screen, behind everything) -->
    <div class="home__map">
      <MapView>
        <!-- Route polylines -->
        <LineRoute
          v-for="route in routeLayers"
          :key="'route-' + route.lineId"
          :line-id="route.lineId"
          :route-data="route.data"
          :outward-color="route.outwardColor"
          :return-color="route.returnColor"
        />

        <!-- Bus markers (single imperative layer for performance) -->
        <BusMarkerLayer :vehicles="enrichedVehicles" />
      </MapView>
    </div>

    <!-- Bottom drawer -->
    <div
      class="home__drawer"
      :class="`home__drawer--${drawerState}`"
      :style="{ transform: drawerTransform }"
    >
      <div
        class="home__drawer-handle"
        @click="cycleDrawer"
        @touchstart.passive="onTouchStart"
        @touchend.passive="onTouchEnd"
      ></div>
      <LineSelector />
    </div>
  </div>
</template>

<style scoped>
.home {
  position: relative;
  width: 100%;
  height: 100dvh;
  overflow: hidden;
  background: #f5f5f5;
}

/* -- Map -- */
.home__map {
  position: absolute;
  inset: 0;
  z-index: 0;
}

/* -- Bottom Drawer -- */
.home__drawer {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 100vh;
  height: 100dvh;
  z-index: 1000;
  background: #ffffff;
  border-radius: 20px 20px 0 0;
  box-shadow: 0 -4px 24px rgba(0, 0, 0, 0.12);
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  will-change: transform;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  touch-action: pan-y;
}

.home__drawer-handle {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 32px;
  padding: 8px 0;
  cursor: grab;
  user-select: none;
  -webkit-user-select: none;
  -webkit-tap-highlight-color: transparent;
}

.home__drawer-handle:active {
  cursor: grabbing;
}

.home__drawer-handle::after {
  content: '';
  width: 36px;
  height: 4px;
  border-radius: 2px;
  background: #d1d5db;
  transition: background 0.2s;
}

.home__drawer-handle:active::after {
  background: #9ca3af;
}

/* Desktop: drawer on the left as a sidebar card */
@media (min-width: 769px) {
  .home__drawer {
    position: absolute;
    top: 16px;
    bottom: 16px;
    left: 16px;
    right: auto;
    width: 380px;
    height: auto !important;
    transform: none !important;
    border-radius: 16px;
    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.12);
  }

  .home__drawer-handle {
    display: none;
  }
}
</style>
