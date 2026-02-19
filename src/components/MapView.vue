<script setup>
/**
 * MapView - MapLibre GL JS map wrapper.
 *
 * Initializes a MapLibre GL map centered on Lyon and provides the map instance
 * to child components via provide/inject.
 */

import { ref, provide, onMounted, onBeforeUnmount } from 'vue'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'

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

provide('maplibreMap', mapInstance)

onMounted(() => {
  if (!mapContainer.value) return

  const map = new maplibregl.Map({
    container: mapContainer.value,
    style: 'https://tiles.openfreemap.org/styles/positron',
    center: [props.centerLng, props.centerLat],
    zoom: props.zoom,
    attributionControl: true,
  })

  // Navigation control (zoom buttons) top-right
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')

  map.on('load', () => {
    // Replace all text fonts with Metropolis
    const style = map.getStyle()
    for (const layer of style.layers) {
      if (layer.layout && layer.layout['text-font']) {
        const fonts = layer.layout['text-font']
        const newFonts = fonts.map((f) =>
          f.replace(/Noto Sans/gi, 'Metropolis')
           .replace(/Roboto/gi, 'Metropolis')
        )
        map.setLayoutProperty(layer.id, 'text-font', newFonts)
      }
    }
    mapInstance.value = map
  })

  // If map loads synchronously (style already cached), set immediately
  if (map.loaded()) {
    mapInstance.value = map
  }
})

onBeforeUnmount(() => {
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
