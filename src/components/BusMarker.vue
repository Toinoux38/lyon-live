<script setup>
/**
 * BusMarker - Renderless component that manages a single Leaflet marker.
 *
 * Animation uses requestAnimationFrame to interpolate lat/lng over time.
 * This avoids interfering with Leaflet's own CSS transforms during zoom/pan.
 */

import { watch, inject, onMounted, onBeforeUnmount } from 'vue'
import L from 'leaflet'

const ANIM_DURATION = 1500 // ms

const props = defineProps({
  vehicleId: { type: String, required: true },
  lat: { type: Number, required: true },
  lng: { type: Number, required: true },
  bearing: { type: Number, default: 0 },
  color: { type: String, default: 'c62828' },
  lineName: { type: String, default: '' },
  direction: { type: String, default: '' },
})

const map = inject('leafletMap')
let marker = null
let animFrame = null
let prevBearing = -1
let prevColor = ''

function createIcon() {
  const bearing = ((props.bearing || 0) + 180) % 360
  const bg = `#${props.color}`

  return L.divIcon({
    className: 'bus-marker-container',
    html: `<div class="bus-marker" style="--bus-color:${bg};--bearing:${bearing}deg;"><div class="bus-marker__arrow"></div><div class="bus-marker__dot"><span class="bus-marker__label">${props.lineName || ''}</span></div></div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -18],
  })
}

function getPopupContent() {
  const dir = props.direction === 'outward' ? 'Aller' : 'Retour'
  return `<div style="font-family:Inter,system-ui,sans-serif;font-size:13px;line-height:1.5;min-width:100px;"><div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;"><span style="padding:2px 8px;border-radius:4px;background:#${props.color};color:#fff;font-weight:700;font-size:12px;">${props.lineName || '?'}</span><span style="color:#888;font-size:12px;">${dir}</span></div><span style="color:#aaa;font-size:11px;">${props.lat.toFixed(4)}, ${props.lng.toFixed(4)}</span></div>`
}

function initMarker() {
  if (!map?.value) return

  marker = L.marker([props.lat, props.lng], {
    icon: createIcon(),
    zIndexOffset: 1000,
  })

  marker.bindPopup(getPopupContent(), {
    closeButton: false,
    className: 'bus-popup',
    offset: [0, -4],
  })

  marker.addTo(map.value)
  prevBearing = props.bearing
  prevColor = props.color
}

/**
 * Animate marker to new position using requestAnimationFrame.
 * Interpolates lat/lng linearly over ANIM_DURATION ms.
 * Does NOT touch CSS transforms -- fully compatible with Leaflet zoom/pan.
 */
function animateToPosition(targetLat, targetLng) {
  if (!marker) return

  // Cancel any running animation
  if (animFrame) {
    cancelAnimationFrame(animFrame)
    animFrame = null
  }

  const startLatLng = marker.getLatLng()
  const startLat = startLatLng.lat
  const startLng = startLatLng.lng
  const dLat = targetLat - startLat
  const dLng = targetLng - startLng

  // Skip animation if distance is negligible
  if (Math.abs(dLat) < 0.000001 && Math.abs(dLng) < 0.000001) return

  const startTime = performance.now()

  function step(now) {
    const elapsed = now - startTime
    const t = Math.min(elapsed / ANIM_DURATION, 1)
    // ease-out quad
    const ease = t * (2 - t)

    marker.setLatLng([
      startLat + dLat * ease,
      startLng + dLng * ease,
    ])

    if (t < 1) {
      animFrame = requestAnimationFrame(step)
    } else {
      animFrame = null
    }
  }

  animFrame = requestAnimationFrame(step)
}

function updateMarker() {
  if (!marker) return

  // Animate position
  animateToPosition(props.lat, props.lng)

  // Only recreate icon when bearing or color actually changed
  const newBearing = ((props.bearing || 0) + 180) % 360
  const oldBearing = ((prevBearing || 0) + 180) % 360
  if (newBearing !== oldBearing || props.color !== prevColor) {
    marker.setIcon(createIcon())
    prevBearing = props.bearing
    prevColor = props.color
  }

  marker.setPopupContent(getPopupContent())
}

onMounted(() => {
  initMarker()
})

onBeforeUnmount(() => {
  if (animFrame) cancelAnimationFrame(animFrame)
  if (marker && map?.value) {
    map.value.removeLayer(marker)
    marker = null
  }
})

watch(
  () => [props.lat, props.lng, props.bearing, props.color],
  () => {
    if (marker) updateMarker()
    else initMarker()
  },
)
</script>

<template>
  <!-- Renderless -->
</template>
