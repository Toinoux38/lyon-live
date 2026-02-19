<script setup>
/**
 * BusMarkerLayer – single imperative component that manages ALL bus markers.
 *
 * Key design decisions (senior map-dev best practices):
 *  1. ONE component → no per-marker Vue overhead (watchers, reactive deps).
 *  2. Diff-based sync → only add / remove / update what changed each poll.
 *  3. Single rAF animation loop → one timer drives all markers, not N timers.
 *  4. Zoom/pan guard → DEFERS all sync + animation while the map is moving.
 *  5. DOM marker reuse → only rebuild the element when bearing or color changes.
 *
 * Uses MapLibre GL JS markers (DOM-based) for bus positions.
 */

import { watch, inject, onMounted, onBeforeUnmount } from 'vue'
import maplibregl from 'maplibre-gl'
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
const map = inject('maplibreMap')
const store = useBusStore()

/**
 * Internal marker registry.
 * Map<vehicleId, {
 *   marker, popup, element, lat, lng, srcLat, srcLng, dstLat, dstLng,
 *   bearing, color, lineName, direction
 * }>
 */
const registry = new Map()

let animFrameId = null
let animStart = 0
let mapBusy = false          // true while zoom / pan animation is in flight
let pendingVehicles = null   // buffered data received while map is busy

const ANIM_MS = 2200         // duration of position interpolation

/* ------------------------------------------------------------------ */
/*  DOM element factory for bus markers                                */
/* ------------------------------------------------------------------ */
function buildElement(bearing, color, lineName) {
  const deg = ((bearing || 0) + 180) % 360
  const bg = `#${color}`
  const el = document.createElement('div')
  el.className = 'bus-marker-container'
  el.innerHTML = `<div class="bus-marker" style="--bus-color:${bg};--bearing:${deg}deg"><div class="bus-marker__arrow"></div><div class="bus-marker__dot"><span class="bus-marker__label">${lineName || ''}</span></div></div>`
  el.style.cursor = 'pointer'
  return el
}

function updateElement(el, bearing, color, lineName) {
  const deg = ((bearing || 0) + 180) % 360
  const bg = `#${color}`
  const inner = el.querySelector('.bus-marker')
  if (inner) {
    inner.style.setProperty('--bus-color', bg)
    inner.style.setProperty('--bearing', `${deg}deg`)
    const label = inner.querySelector('.bus-marker__label')
    if (label) label.textContent = lineName || ''
  }
}

function buildPopupHtml(v, nextStopName) {
  const nextStop = nextStopName || '?'
  return `<div style="font-family:'Figtree',system-ui,sans-serif;font-size:13px;line-height:1.5;min-width:120px"><div style="display:flex;align-items:center;gap:6px;margin-bottom:6px"><span style="padding:2px 8px;border-radius:4px;background:#${v.lineColor};color:#fff;font-weight:700;font-size:12px">${v.lineName || '?'}</span><span style="color:#888;font-size:12px;flex:1;min-width:0;text-overflow:ellipsis;white-space:nowrap;overflow:hidden">${v.destination || ''}</span></div><div style="color:#666;font-size:11px;font-weight:600;margin-bottom:4px">Next Stop</div><span style="color:#333;font-size:11px">${nextStop}</span></div>`
}

/* ------------------------------------------------------------------ */
/*  Map-event guards                                                   */
/* ------------------------------------------------------------------ */
function onBusy() {
  mapBusy = true
  cancelAnim()
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
  m.on('movestart', onBusy)
  m.on('moveend', onIdle)
}

function unbindMapEvents(m) {
  m.off('movestart', onBusy)
  m.off('moveend', onIdle)
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
      s.marker.setLngLat([newLng, newLat])

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
  if (!map?.value) return

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
        updateElement(existing.element, v.bearing, v.lineColor, v.lineName)
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

      // Update popup content
      existing.popup.setHTML(buildPopupHtml(v, nextStopName))
    } else {
      /* ---------- ADD new marker ---------- */
      const element = buildElement(v.bearing, v.lineColor, v.lineName)

      const popup = new maplibregl.Popup({
        closeButton: false,
        offset: [0, -20],
        className: 'bus-popup',
      }).setHTML(buildPopupHtml(v, nextStopName))

      const marker = new maplibregl.Marker({ element, anchor: 'center' })
        .setLngLat([v.longitude, v.latitude])
        .setPopup(popup)
        .addTo(map.value)

      // Show popup on hover
      element.addEventListener('mouseenter', () => marker.togglePopup())
      element.addEventListener('mouseleave', () => popup.remove())

      registry.set(v.id, {
        marker,
        popup,
        element,
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
      s.marker.remove()
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
  // Clear all markers
  for (const s of registry.values()) {
    s.marker.remove()
  }
  registry.clear()
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
