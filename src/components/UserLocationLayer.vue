<script setup>
/**
 * UserLocationLayer (renderless)
 *
 * Shows the device position as a blue dot with a CSS pulse (+ heading cone
 * when available) using a single DOM marker. CSS animation runs on the
 * compositor, so the map itself never has to repaint for it.
 *
 * Permission etiquette: tracking starts on mount only if the permission was
 * already granted; otherwise we wait for the user to tap "locate me".
 *
 * Exposes: { status, position, locate }
 *   status: 'idle' | 'locating' | 'active' | 'denied' | 'unavailable'
 */

import { inject, ref, shallowRef, watch, onMounted, onBeforeUnmount } from 'vue'
import maplibregl from 'maplibre-gl'

const map = inject('maplibreMap')

const status = ref('idle')
const position = shallowRef(null) // GeolocationCoordinates | null

let watchId = null
let marker = null
let el = null
let flyOnFix = false

function buildElement() {
  const div = document.createElement('div')
  div.className = 'user-loc'
  div.innerHTML = '<div class="user-loc__cone"></div><div class="user-loc__pulse"></div><div class="user-loc__dot"></div>'
  return div
}

function render() {
  const m = map?.value
  const c = position.value
  if (!m || !c) return
  if (!marker) {
    el = buildElement()
    marker = new maplibregl.Marker({ element: el, anchor: 'center' })
      .setLngLat([c.longitude, c.latitude])
      .addTo(m)
  } else {
    marker.setLngLat([c.longitude, c.latitude])
  }

  const hasHeading = typeof c.heading === 'number' && !Number.isNaN(c.heading) && (c.speed ?? 0) > 0.5
  el.classList.toggle('user-loc--heading', hasHeading)
  if (hasHeading) el.style.setProperty('--heading', `${c.heading}deg`)
}

function flyToPosition() {
  const m = map?.value
  const c = position.value
  if (!m || !c) return
  m.flyTo({
    center: [c.longitude, c.latitude],
    zoom: Math.max(m.getZoom(), 15.5),
    speed: 1.6,
  })
}

function startTracking() {
  if (watchId !== null) return
  if (!('geolocation' in navigator)) {
    status.value = 'unavailable'
    return
  }
  status.value = position.value ? 'active' : 'locating'

  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      position.value = pos.coords
      status.value = 'active'
      render()
      if (flyOnFix) {
        flyOnFix = false
        flyToPosition()
      }
    },
    (err) => {
      console.warn('[UserLocation] geolocation error:', err.message)
      flyOnFix = false
      if (err.code === err.PERMISSION_DENIED) {
        status.value = 'denied'
        stopTracking()
      } else if (!position.value) {
        status.value = 'unavailable'
      }
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
  )
}

function stopTracking() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId)
    watchId = null
  }
}

/** Public: center on the user, asking for permission if needed. */
function locate() {
  if (position.value) {
    flyToPosition()
    return
  }
  flyOnFix = true
  if (status.value === 'denied' || status.value === 'unavailable') {
    // Let the browser re-ask / retry — the user may have changed the setting
    stopTracking()
  }
  startTracking()
}

onMounted(async () => {
  try {
    const perm = await navigator.permissions?.query({ name: 'geolocation' })
    if (perm?.state === 'granted') startTracking()
    if (perm?.state === 'denied') status.value = 'denied'
  } catch {
    /* Permissions API unsupported (older Safari) — wait for a tap */
  }
})

watch(() => map?.value, render)

onBeforeUnmount(() => {
  stopTracking()
  marker?.remove()
  marker = null
})

defineExpose({ status, position, locate })
</script>

<template><!-- renderless --></template>
