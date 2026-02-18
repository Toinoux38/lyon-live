<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useBusStore } from '@/store/busStore'
import MapView from '@/components/MapView.vue'
import BusMarkerLayer from '@/components/BusMarkerLayer.vue'
import LineRoute from '@/components/LineRoute.vue'
import LineSelector from '@/components/LineSelector.vue'

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

const enrichedVehicles = computed(() => store.vehicles.map((v) => {
  let matchedLineId = null
  for (const lineId of store.selectedIds) {
    const code = store.lineMap[lineId]?.sName
    if (code && v.id?.includes(code)) { matchedLineId = lineId; break }
  }
  if (!matchedLineId && store.selectedIds.length > 0) matchedLineId = store.selectedIds[0]
  const slot = lineColorSlots.value[matchedLineId] || SLOT_COLORS[0]
  return {
    ...v,
    lineColor: (v.direction === 'return' ? slot.return : slot.outward).replace('#', ''),
    lineName: store.lineMap[matchedLineId]?.sName || '?'
  }
}))

const routeLayers = computed(() => store.activeRoutes.map((r) => {
  const slot = lineColorSlots.value[r.lineId] || SLOT_COLORS[0]
  return { lineId: r.lineId, data: r.data, outwardColor: slot.outward, returnColor: slot.return }
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
      />
      <BusMarkerLayer :vehicles="enrichedVehicles" />
    </MapView>
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
</style>
