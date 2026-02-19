<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useBusStore } from '@/store/busStore'
import MapView from '@/components/MapView.vue'
import BusMarkerLayer from '@/components/BusMarkerLayer.vue'
import LineRoute from '@/components/LineRoute.vue'
import LineSelector from '@/components/LineSelector.vue'
import StatusBar from '@/components/StatusBar.vue'

const store = useBusStore()

const SLOT_COLORS = [
  { outward: '#DC2626', return: '#F87171' },
  { outward: '#1E3A5F', return: '#60A5FA' },
  { outward: '#374151', return: '#9CA3AF' },
]

const lineColorSlots = computed(() => {
  const map = {}
  store.selectedIds.forEach((id, idx) => { map[id] = SLOT_COLORS[idx] || SLOT_COLORS[0] })
  return map
})

const enrichedVehicles = computed(() =>
  store.vehicles
    .filter((v) => {
      const dir = store.lineDirectionMap[v.lineId] || 'both'
      return dir === 'both' || v.direction === dir
    })
    .map((v) => {
    // v.lineId is now reliably set by fetchVehiclePositions (per-line fetch).
    // Fall back to the first selected line only if lineId is missing/deselected.
    const matchedLineId =
      v.lineId && store.selectedLineIds.has(v.lineId)
        ? v.lineId
        : (store.selectedIds[0] ?? null)

    const slot = lineColorSlots.value[matchedLineId] || SLOT_COLORS[0]
    const line = store.lineMap[matchedLineId]
    
    // Parse destination from line name (e.g. "Part-Dieu - Gare Routière")
    let destination = ''
    if (line?.lName) {
      const parts = line.lName.split(' - ')
      if (v.direction === 'outward' && parts.length >= 2) {
        destination = parts[parts.length - 1].trim()
      } else if (v.direction === 'return' && parts.length >= 1) {
        destination = parts[0].trim()
      }
    }

    return {
      ...v,
      lineColor: (v.direction === 'return' ? slot.return : slot.outward).replace('#', ''),
      lineName: line?.sName || '?',
      destination,
    }
  }),
)

const routeLayers = computed(() => store.activeRoutes.map((r) => {
  const slot = lineColorSlots.value[r.lineId] || SLOT_COLORS[0]
  const direction = store.lineDirectionMap[r.lineId] || 'both'
  return { lineId: r.lineId, data: r.data, outwardColor: slot.outward, returnColor: slot.return, direction }
}))

onMounted(() => store.loadLines())
onBeforeUnmount(() => store.stopPolling())
watch(() => store.activeLineCount, (count) => { count > 0 ? store.startPolling() : store.stopPolling() })
</script>

<template>
  <div class="home">
    <MapView class="home__map">
      <LineRoute
        v-for="route in routeLayers"
        :key="'route-' + route.lineId"
        :line-id="route.lineId"
        :route-data="route.data"
        :outward-color="route.outwardColor"
        :return-color="route.returnColor"
        :direction="route.direction"
      />
      <BusMarkerLayer :vehicles="enrichedVehicles" />
    </MapView>
    <StatusBar class="home__status" />
    <LineSelector />
  </div>
</template>

<style scoped>
.home {
  position: relative;
  width: 100%;
  height: 100dvh;
  overflow: hidden;
}
.home__map {
  position: absolute;
  inset: 0;
  z-index: 0;
}
.home__status {
  position: absolute;
  bottom: 104px; /* sits above the collapsed bottom sheet (~96px) */
  left: 50%;
  transform: translateX(-50%);
  z-index: 1001;
  max-width: calc(100% - 32px);
  border-radius: 20px;
  box-shadow: 0 2px 12px rgba(0,0,0,0.12);
}
@media (min-width: 769px) {
  .home__status {
    left: 392px; /* right of the 360px sidebar + 16px gap + 16px margin */
    transform: none;
    bottom: 16px;
  }
}
</style>
