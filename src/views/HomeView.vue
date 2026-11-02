<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { Locate, LocateFixed, LocateOff, LoaderCircle } from 'lucide-vue-next'
import { useBusStore } from '@/store/busStore'
import MapView from '@/components/MapView.vue'
import VehicleMarkerLayer from '@/components/VehicleMarkerLayer.vue'
import LineRoute from '@/components/LineRoute.vue'
import LineSelector from '@/components/LineSelector.vue'
import StatusBar from '@/components/StatusBar.vue'
import UserLocationLayer from '@/components/UserLocationLayer.vue'
import { getLineGroupInfo, isTramLine } from '@/utils/lineGroup'
import { parseRoute, routeBounds } from '@/utils/routeGeometry'
import { slotColors } from '@/utils/slotColors'

const store = useBusStore()

const mapView = ref(null)
const locationLayer = ref(null)
const mobileSheetOpen = ref(false)

function onSheetOpenChange(isOpenOnMobile) {
  mobileSheetOpen.value = isOpenOnMobile
}

// ---- locate-me button -------------------------------------------------
const locStatus = computed(() => locationLayer.value?.status ?? 'idle')
const locIcon = computed(() => ({
  locating: LoaderCircle,
  active: LocateFixed,
  denied: LocateOff,
  unavailable: LocateOff,
}[locStatus.value] ?? Locate))
const locTitle = computed(() => ({
  locating: 'Finding your location…',
  denied: 'Location blocked — allow it in your browser settings',
  unavailable: 'Location unavailable — tap to retry',
}[locStatus.value] ?? 'Center on my location'))

function locateMe() {
  locationLayer.value?.locate()
}

// ---- vehicles & routes ------------------------------------------------
function destinationFor(line, routeData, direction) {
  const headsign = routeData && parseRoute(routeData)[direction === 'return' ? 'return' : 'outward']?.headsign
  if (headsign) return headsign
  // Fallback before the route has loaded: "A - B" → B outward, A return
  const parts = (line?.lName || '').split(' - ').map((s) => s.trim())
  if (parts.length < 2) return ''
  return direction === 'return' ? parts[0] : parts[parts.length - 1]
}

const enrichedVehicles = computed(() =>
  store.visibleVehicles.map((v) => {
    const line = store.lineMap[v.lineId]
    const slot = slotColors(store.lineSlots[v.lineId])
    const gi = line ? getLineGroupInfo(line) : null
    return {
      ...v,
      lineColor: (v.direction === 'return' ? slot.return : slot.outward).slice(1),
      lineName: line?.sName || '?',
      isTram: v.mode === 'TRAM' || isTramLine(line),
      destination: destinationFor(line, store.lineRoutes.get(v.lineId), v.direction),
      badge: gi && {
        prefix: gi.prefix,
        number: gi.number,
        prefixColor: gi.prefixColor,
        color: line.color,
        textColor: line.textColor,
      },
    }
  }),
)

const routeLayers = computed(() => store.activeRoutes.map((r) => {
  const slot = slotColors(store.lineSlots[r.lineId])
  return {
    lineId: r.lineId,
    data: r.data,
    outwardColor: slot.outward,
    returnColor: slot.return,
    direction: store.lineDirectionMap[r.lineId] || 'both',
    isTram: isTramLine(store.lineMap[r.lineId]),
  }
}))

// ---- frame a freshly picked line ---------------------------------------
let pendingFocus = null

function tryFocus() {
  const map = mapView.value?.mapInstance
  if (!pendingFocus || !map) return
  if (!store.selectedLineIds.has(pendingFocus)) { pendingFocus = null; return }
  const data = store.lineRoutes.get(pendingFocus)
  if (!data) return // wait for the route to load
  pendingFocus = null

  const bounds = routeBounds(data)
  if (!bounds) return
  const desktop = window.innerWidth >= 769
  map.fitBounds(bounds, {
    padding: desktop
      ? { top: 60, bottom: 60, left: 392 + 24, right: 70 }
      : { top: 70, bottom: 170, left: 30, right: 30 },
    maxZoom: 15,
    duration: 900,
  })
}

watch(() => store.focusRequest.seq, () => {
  pendingFocus = store.focusRequest.lineId
  tryFocus()
})
watch(() => [store.lineRoutes.size, mapView.value?.mapInstance], tryFocus)

// ---- lifecycle --------------------------------------------------------
onMounted(() => store.loadLines())
onBeforeUnmount(() => store.stopPolling())
watch(() => store.activeLineCount, (count) => { count > 0 ? store.startPolling() : store.stopPolling() })
</script>

<template>
  <div class="home">
    <MapView ref="mapView" class="home__map">
      <LineRoute
        v-for="route in routeLayers"
        :key="'route-' + route.lineId"
        :line-id="route.lineId"
        :route-data="route.data"
        :outward-color="route.outwardColor"
        :return-color="route.returnColor"
        :direction="route.direction"
        :is-tram="route.isTram"
      />
      <VehicleMarkerLayer :vehicles="enrichedVehicles" />
      <UserLocationLayer ref="locationLayer" />
    </MapView>

    <StatusBar class="home__status" />

    <button
      v-show="!mobileSheetOpen"
      class="home__locate-btn"
      :class="'home__locate-btn--' + locStatus"
      :title="locTitle"
      :aria-label="locTitle"
      @click="locateMe"
    >
      <component :is="locIcon" class="home__locate-icon" />
    </button>

    <LineSelector @sheet-open-change="onSheetOpenChange" />
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

/* Mobile: status floats at the top-left, clear of the bottom sheet */
.home__status {
  position: absolute;
  top: calc(12px + env(safe-area-inset-top, 0px));
  left: 12px;
  z-index: 998;
  max-width: calc(100% - 80px); /* leave room for the zoom buttons */
}

/* ---- Locate-me button -------------------------------------------- */
.home__locate-btn {
  position: absolute;
  bottom: 156px; /* above the resting bottom sheet (140px) */
  right: 16px;
  z-index: 998;
  width: 44px;
  height: 44px;
  border: none;
  border-radius: 50%;
  background: #fff;
  color: #4285F4;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 10px rgba(0,0,0,0.18);
  transition: background 0.15s, transform 0.1s, box-shadow 0.15s, color 0.15s;
  -webkit-tap-highlight-color: transparent;
}
.home__locate-btn:hover {
  background: #f0f6ff;
  box-shadow: 0 3px 14px rgba(66,133,244,0.28);
}
.home__locate-btn:active { transform: scale(0.91); }
.home__locate-icon { width: 22px; height: 22px; stroke-width: 2; }
.home__locate-btn--idle { color: #3a3a3c; }
.home__locate-btn--denied,
.home__locate-btn--unavailable { color: #9ca3af; }
.home__locate-btn--locating .home__locate-icon { animation: spin 0.9s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

@media (min-width: 769px) {
  .home__status {
    top: auto;
    left: 392px; /* right of the 360px sidebar + 16px gap + 16px margin */
    bottom: 16px;
    max-width: calc(100% - 392px - 80px);
  }
  .home__locate-btn {
    bottom: 40px; /* clear of the attribution button */
    right: 10px;
  }
}
</style>
