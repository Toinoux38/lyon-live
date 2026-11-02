<script setup>
/**
 * MapView – MapLibre GL JS map wrapper.
 *
 * Initializes a MapLibre map centered on Lyon and provides the map instance
 * to child components via provide/inject ('maplibreMap'). Children wait for
 * the instance to be non-null, which happens once the style has loaded.
 */

import { ref, shallowRef, provide, onMounted, onBeforeUnmount } from 'vue'
import maplibregl from 'maplibre-gl'

const props = defineProps({
  centerLat: { type: Number, default: 45.7580 },
  centerLng: { type: Number, default: 4.8320 },
  zoom: { type: Number, default: 13 },
})

const mapContainer = ref(null)
// shallowRef: the map is a big mutable object, Vue must not deep-proxy it
const mapInstance = shallowRef(null)

provide('maplibreMap', mapInstance)

let map = null

onMounted(() => {
  if (!mapContainer.value) return

  map = new maplibregl.Map({
    container: mapContainer.value,
    style: 'https://tiles.openfreemap.org/styles/positron',
    center: [props.centerLng, props.centerLat],
    zoom: props.zoom,
    minZoom: 9,
    maxPitch: 0,
    dragRotate: false,
    attributionControl: { compact: true },
  })
  map.touchZoomRotate.disableRotation()

  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')

  map.on('load', () => {
    mapInstance.value = map
  })

  // Dev-only handle for poking at the map from the console
  if (import.meta.env.DEV) window.__map = map
})

onBeforeUnmount(() => {
  map?.remove()
  map = null
  mapInstance.value = null
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
