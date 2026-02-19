<script setup>
/**
 * BusMarkerLayer – single imperative component that manages ALL bus markers.
 *
 * Key design decisions (senior map-dev best practices):
 *  1. ONE component → no per-marker Vue overhead (watchers, reactive deps).
 *  2. Diff-based sync → only add / remove / update what changed each poll.
 *  3. Single rAF animation loop → one timer drives all markers, not N timers.
 *  4. Zoom/pan guard → DEFERS all sync + animation while the map is zooming
 *     or panning so Leaflet stays in full control of marker DOM elements.
 *  5. Icon reuse → only rebuild the DivIcon when bearing or color changes.
 *  6. Safe marker ops → every setLatLng/removeLayer guarded against null _map.
 */

import { watch, inject, onMounted, onBeforeUnmount } from 'vue'
import L from 'leaflet'
import { useBusStore } from '@/store/busStore'
import { calculateNextStop } from '@/utils/nextStop'

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */
const props = defineProps({
  /** Enriched vehicle array from the store */
  vehicles: { type: Array, default: () => [] },
})

/* ------------------------------------------------------------------ */
/*  State                                                              */
/* ------------------------------------------------------------------ */
const map = inject('leafletMap')
const store = useBusStore()

/**
 * Internal marker registry.
 * Map<vehicleId, {
 *   marker, lat, lng, srcLat, srcLng, dstLat, dstLng,
 *   bearing, color, lineName, direction
 * }>
 */
const registry = new Map()

let layerGroup = null
let animFrameId = null
let animStart = 0
let mapBusy = false          // true while zoom / pan animation is in flight
let pendingVehicles = null   // buffered data received while map is busy

const ANIM_MS = 2200         // duration of position interpolation

/* ------------------------------------------------------------------ */
/*  Icon factory                                                       */
/* ------------------------------------------------------------------ */
function buildIcon(bearing, color, lineName) {
  const deg = ((bearing || 0) + 180) % 360
  const bg = `#${color}`
  return L.divIcon({
    className: 'bus-marker-container',
    html: `<div class="bus-marker" style="--bus-color:${bg};--bearing:${deg}deg"><div class="bus-marker__arrow"></div><div class="bus-marker__dot"><span class="bus-marker__label">${lineName || ''}</span></div></div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    popupAnchor: [0, -20],
  })
}

function buildPopup(v, nextStopName) {
  const nextStop = nextStopName || '?'
  return `<div style="font-family:'Figtree',system-ui,sans-serif;font-size:13px;line-height:1.5;min-width:120px"><div style="display:flex;align-items:center;gap:6px;margin-bottom:6px"><span style="padding:2px 8px;border-radius:4px;background:#${v.lineColor};color:#fff;font-weight:700;font-size:12px">${v.lineName || '?'}</span><span style="color:#888;font-size:12px;flex:1;min-width:0;text-overflow:ellipsis;white-space:nowrap;overflow:hidden">${v.destination || ''}</span></div><div style="color:#666;font-size:11px;font-weight:600;margin-bottom:4px">Next Stop</div><span style="color:#333;font-size:11px">${nextStop}</span></div>`
}

/* ------------------------------------------------------------------ */
/*  Safe marker helpers                                                */
/* ------------------------------------------------------------------ */
/** setLatLng only if marker is still attached to the map. */
function safeSetLatLng(marker, lat, lng) {
  if (marker._map) marker.setLatLng([lat, lng])
}

/** Remove marker from layerGroup only if it's still on a map. */
function safeRemove(marker) {
  if (marker._map && layerGroup) {
    layerGroup.removeLayer(marker)
  }
}

/* ------------------------------------------------------------------ */
/*  Map-event guards                                                   */
/* ------------------------------------------------------------------ */
function onBusy() {
  mapBusy = true
  cancelAnim()
  // Do NOT call snapAll/setLatLng during zoom — let Leaflet handle everything
}

function onIdle() {
  mapBusy = false
  // Flush any buffered vehicle data that arrived while map was busy
  if (pendingVehicles) {
    const data = pendingVehicles
    pendingVehicles = null
    sync(data)
  }
}

function bindMapEvents(m) {
  m.on('zoomstart movestart', onBusy)
  m.on('zoomend moveend', onIdle)
}

function unbindMapEvents(m) {
  m.off('zoomstart movestart', onBusy)
  m.off('zoomend moveend', onIdle)
}

/* ------------------------------------------------------------------ */
/*  Animation loop (single loop drives ALL markers)                    */
/* ------------------------------------------------------------------ */
function cancelAnim() {
  if (animFrameId) {
    cancelAnimationFrame(animFrameId)
    animFrameId = null
  }
}

function startAnim() {
  cancelAnim()
  if (mapBusy) return  // Never animate while map is busy

  animStart = performance.now()

  function tick(now) {
    // Abort immediately if map became busy mid-frame
    if (mapBusy) { animFrameId = null; return }

    const t = Math.min((now - animStart) / ANIM_MS, 1)
    const ease = t * (2 - t) // ease-out quad

    for (const s of registry.values()) {
      if (s.lat === s.dstLat && s.lng === s.dstLng) continue
      const newLat = s.srcLat + (s.dstLat - s.srcLat) * ease
      const newLng = s.srcLng + (s.dstLng - s.srcLng) * ease
      safeSetLatLng(s.marker, newLat, newLng)

      if (t >= 1) {
        s.lat = s.dstLat
        s.lng = s.dstLng
      }
    }

    if (t < 1) {
      animFrameId = requestAnimationFrame(tick)
    } else {
      animFrameId = null
    }
  }

  animFrameId = requestAnimationFrame(tick)
}

/* ------------------------------------------------------------------ */
/*  Diff-sync: reconcile registry with incoming vehicle array           */
/* ------------------------------------------------------------------ */
function sync(vehicles) {
  if (!map?.value || !layerGroup) return

  // If the map is mid-zoom/pan, buffer data and apply after idle
  if (mapBusy) {
    pendingVehicles = vehicles
    return
  }

  const incomingIds = new Set()

  for (const v of vehicles) {
    incomingIds.add(v.id)
    const existing = registry.get(v.id)

    // Calculate next stop
    const routeData = store.lineRoutes.get(v.lineId)
    const nextStopName = routeData ? calculateNextStop(v, routeData, v.direction) : null

    if (existing) {
      /* ---------- UPDATE existing marker ---------- */
      const bearingChanged = existing.bearing !== v.bearing
      const colorChanged   = existing.color !== v.lineColor
      const nameChanged    = existing.lineName !== v.lineName

      if (bearingChanged || colorChanged || nameChanged) {
        existing.marker.setIcon(buildIcon(v.bearing, v.lineColor, v.lineName))
        existing.bearing  = v.bearing
        existing.color    = v.lineColor
        existing.lineName = v.lineName
      }

      // Set up animation targets (from current rendered pos → new API pos)
      existing.srcLat = existing.lat
      existing.srcLng = existing.lng
      existing.dstLat = v.latitude
      existing.dstLng = v.longitude
      existing.direction = v.direction
      existing.nextStopName = nextStopName

      existing.marker.setPopupContent(buildPopup(v, nextStopName))
    } else {
      /* ---------- ADD new marker ---------- */
      const marker = L.marker([v.latitude, v.longitude], {
        icon: buildIcon(v.bearing, v.lineColor, v.lineName),
        zIndexOffset: 1000,
      })

      marker.bindPopup(buildPopup(v, nextStopName), {
        closeButton: false,
        className: 'bus-popup',
        offset: [0, -4],
      })

      marker.addTo(layerGroup)

      registry.set(v.id, {
        marker,
        lat: v.latitude,
        lng: v.longitude,
        srcLat: v.latitude,
        srcLng: v.longitude,
        dstLat: v.latitude,
        dstLng: v.longitude,
        bearing: v.bearing,
        color: v.lineColor,
        lineName: v.lineName,
        direction: v.direction,
        nextStopName,
      })
    }
  }

  /* ---------- REMOVE stale markers ---------- */
  for (const [id, s] of registry) {
    if (!incomingIds.has(id)) {
      safeRemove(s.marker)
      registry.delete(id)
    }
  }

  // Kick the animation loop for this batch
  startAnim()
}

/* ------------------------------------------------------------------ */
/*  Lifecycle                                                          */
/* ------------------------------------------------------------------ */
function init() {
  if (!map?.value) return
  layerGroup = L.layerGroup().addTo(map.value)
  bindMapEvents(map.value)
  if (props.vehicles.length) sync(props.vehicles)
}

onMounted(() => {
  if (map?.value) {
    init()
  } else {
    const stop = watch(
      () => map?.value,
      (m) => {
        if (m) { init(); stop() }
      },
    )
  }
})

onBeforeUnmount(() => {
  cancelAnim()
  if (map?.value) unbindMapEvents(map.value)
  // Clear all markers safely
  for (const s of registry.values()) {
    safeRemove(s.marker)
  }
  registry.clear()
  if (layerGroup && map?.value) {
    map.value.removeLayer(layerGroup)
  }
  layerGroup = null
})

watch(
  () => props.vehicles,
  (v) => sync(v),
  { deep: false },
)
</script>

<template>
  <!-- Renderless: all markers managed imperatively -->
</template>
