<script setup>
/**
 * MapView - Leaflet map wrapper.
 *
 * Initializes a Leaflet map centered on Lyon and provides the map instance
 * to child components via provide/inject. Child BusMarker components
 * attach themselves to this map.
 */

import { ref, provide, onMounted, onBeforeUnmount } from 'vue'
import L from 'leaflet'

/*
 * Monkey-patch Leaflet 1.9.x: Marker._animateZoom crashes with
 * "Cannot read properties of null (reading '_latLngToNewLayerPoint')"
 * when markers are added/removed mid-zoom. This is a known bug.
 * The fix: guard against this._map being null.
 * Same approach used by vue-leaflet, react-leaflet, and maplibre wrappers.
 */
const _origAnimateZoom = L.Marker.prototype._animateZoom
L.Marker.prototype._animateZoom = function (opt) {
  if (!this._map) return
  _origAnimateZoom.call(this, opt)
}

const props = defineProps({
  /** Initial center latitude */
  centerLat: { type: Number, default: 45.7580 },
  /** Initial center longitude */
  centerLng: { type: Number, default: 4.8320 },
  /** Initial zoom level */
  zoom: { type: Number, default: 13 },
})

const mapContainer = ref(null)
const mapInstance = ref(null)
let resizeObserver = null

provide('leafletMap', mapInstance)

onMounted(() => {
  if (!mapContainer.value) return

  const map = L.map(mapContainer.value, {
    center: [props.centerLat, props.centerLng],
    zoom: props.zoom,
    zoomControl: false,
    attributionControl: true,
  })

  // Zoom control top-right (better for mobile)
  L.control.zoom({ position: 'topright' }).addTo(map)

  // Clean, modern tile layer
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 19,
  }).addTo(map)

  mapInstance.value = map

  // Use ResizeObserver to reliably invalidate map size whenever the container resizes
  resizeObserver = new ResizeObserver(() => {
    if (mapInstance.value) mapInstance.value.invalidateSize()
  })
  resizeObserver.observe(mapContainer.value)
})

onBeforeUnmount(() => {
  if (resizeObserver) {
    resizeObserver.disconnect()
    resizeObserver = null
  }
  if (mapInstance.value) {
    mapInstance.value.remove()
    mapInstance.value = null
  }
})

defineExpose({ mapInstance })
</script>

<template>
  <div class="map-view" ref="mapContainer">
    <slot />
  </div>
</template>

<style scoped>
.map-view {
  width: 100%;
  height: 100%;
  min-height: 0;
}
</style>
