<script setup>
/**
 * VehicleMarkerLayer – one imperative component that manages ALL bus & tram markers.
 *
 *  1. ONE component → no per-marker Vue overhead (watchers, reactive deps).
 *  2. Diff-based sync → only add / remove / update what changed each poll.
 *  3. Single rAF animation loop → one timer drives all markers.
 *  4. Pan/zoom guard → defers sync + animation while the map is moving.
 *  5. DOM reuse → elements are patched, never rebuilt.
 *  6. Lazy popups → "next stop" is computed only for the popup that's open.
 *
 * Buses are round, trams are rounded squares; both point in their bearing.
 */

import { watch, inject, onMounted, onBeforeUnmount } from 'vue'
import maplibregl from 'maplibre-gl'
import { useBusStore } from '@/store/busStore'
import { calculateNextStop, escapeHtml } from '@/utils/routeGeometry'

const props = defineProps({
  /** Enriched vehicles (see HomeView.enrichedVehicles) */
  vehicles: { type: Array, default: () => [] },
})

const map = inject('maplibreMap')
const store = useBusStore()

/** Map<vehicleId, MarkerState> */
const registry = new Map()

let animFrameId = null
let animStart = 0
let mapBusy = false
let pendingVehicles = null
let openId = null // vehicle whose popup is currently open

const ANIM_MS = 2200
const hoverCapable = window.matchMedia?.('(hover: hover)').matches ?? true

/* ------------------------------------------------------------------ */
/*  DOM                                                                */
/* ------------------------------------------------------------------ */
/**
 * The TCL feed's `bearing` points where the vehicle is coming FROM: measured
 * against real movement it is consistently ~180° off. Flip it.
 */
function headingOf(v) {
  return typeof v.bearing === 'number' ? (v.bearing + 180) % 360 : null
}

function applyVisuals(el, v) {
  const inner = el.firstElementChild
  const heading = headingOf(v)
  inner.classList.toggle('veh-marker--tram', !!v.isTram)
  inner.classList.toggle('veh-marker--nobearing', heading === null)
  inner.style.setProperty('--veh-color', `#${v.lineColor}`)
  inner.style.setProperty('--bearing', `${heading ?? 0}deg`)
  inner.querySelector('.veh-marker__label').textContent = v.lineName || ''
  el.setAttribute('aria-label', `${v.isTram ? 'Tram' : 'Bus'} ${v.lineName}${v.destination ? ' towards ' + v.destination : ''}`)
}

function buildElement(v) {
  const el = document.createElement('div')
  el.className = 'veh-marker-container'
  el.setAttribute('role', 'button')
  el.innerHTML = '<div class="veh-marker"><div class="veh-marker__arrow"></div><div class="veh-marker__body"><span class="veh-marker__label"></span></div></div>'
  applyVisuals(el, v)
  return el
}

function popupHtml(v) {
  const routeData = store.lineRoutes.get(v.lineId)
  const nextStop = routeData ? calculateNextStop(v, routeData, v.direction) : null
  const b = v.badge || {}
  return `<div class="veh-popup">
    <div class="veh-popup__head">
      <span class="veh-popup__badge"><span style="background:${escapeHtml(b.prefixColor)}">${escapeHtml(b.prefix)}</span><span style="background:#${escapeHtml(b.color)};color:#${escapeHtml(b.textColor)}">${escapeHtml(b.number)}</span></span>
      <span class="veh-popup__dest">${v.destination ? '→ ' + escapeHtml(v.destination) : ''}</span>
    </div>
    <div class="veh-popup__label">Next stop</div>
    <div class="veh-popup__stop">${nextStop ? escapeHtml(nextStop) : '<span class="veh-popup__muted">Locating…</span>'}</div>
  </div>`
}

/* ------------------------------------------------------------------ */
/*  Popups                                                             */
/* ------------------------------------------------------------------ */
function openPopup(id) {
  const s = registry.get(id)
  if (!s) return
  if (openId && openId !== id) registry.get(openId)?.popup.remove()
  s.popup.setHTML(popupHtml(s.vehicle)).setLngLat(s.marker.getLngLat()).addTo(map.value)
  openId = id
}

function closePopup(id) {
  const s = registry.get(id)
  s?.popup.remove()
}

function attachHandlers(id, element) {
  element.addEventListener('click', (e) => {
    e.stopPropagation() // don't let the map's click close it immediately
    // Touch: tap toggles. Mouse: hover already opened it, a click keeps it open.
    if (!hoverCapable && openId === id && registry.get(id)?.popup.isOpen()) closePopup(id)
    else openPopup(id)
  })
  if (hoverCapable) {
    element.addEventListener('mouseenter', () => openPopup(id))
    element.addEventListener('mouseleave', () => closePopup(id))
  }
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
  if (pendingVehicles) {
    const data = pendingVehicles
    pendingVehicles = null
    sync(data)
  } else {
    // An interrupted animation should finish rather than freeze mid-way
    startAnim()
  }
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
  if (mapBusy) return

  // Resume from wherever each marker currently is
  for (const s of registry.values()) {
    s.srcLat = s.lat
    s.srcLng = s.lng
  }
  animStart = performance.now()

  function tick(now) {
    if (mapBusy) { animFrameId = null; return }

    const t = Math.min((now - animStart) / ANIM_MS, 1)
    const ease = t * (2 - t) // ease-out quad
    let moving = false

    for (const [id, s] of registry) {
      if (s.lat === s.dstLat && s.lng === s.dstLng) continue
      moving = true
      // Track the rendered position every frame so an interrupted animation
      // resumes from here instead of snapping back to the previous fix.
      s.lat = t >= 1 ? s.dstLat : s.srcLat + (s.dstLat - s.srcLat) * ease
      s.lng = t >= 1 ? s.dstLng : s.srcLng + (s.dstLng - s.srcLng) * ease
      s.marker.setLngLat([s.lng, s.lat])
      if (id === openId) s.popup.setLngLat([s.lng, s.lat])
    }

    animFrameId = t < 1 && moving ? requestAnimationFrame(tick) : null
  }

  animFrameId = requestAnimationFrame(tick)
}

/* ------------------------------------------------------------------ */
/*  Diff-sync: reconcile registry with incoming vehicle array          */
/* ------------------------------------------------------------------ */
function sync(vehicles) {
  if (!map?.value) return
  if (mapBusy) {
    pendingVehicles = vehicles
    return
  }

  const incomingIds = new Set()

  for (const v of vehicles) {
    incomingIds.add(v.id)
    const s = registry.get(v.id)

    if (s) {
      const prev = s.vehicle
      if (prev.bearing !== v.bearing || prev.lineColor !== v.lineColor
          || prev.lineName !== v.lineName || prev.isTram !== v.isTram) {
        applyVisuals(s.element, v)
      }
      s.vehicle = v
      s.dstLat = v.latitude
      s.dstLng = v.longitude
    } else {
      const element = buildElement(v)
      const popup = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: true,
        focusAfterOpen: false, // focusing scrolled the whole page on desktop
        offset: 20,
        className: 'veh-popup-wrap',
      })
      const marker = new maplibregl.Marker({ element, anchor: 'center' })
        .setLngLat([v.longitude, v.latitude])
        .addTo(map.value)
      attachHandlers(v.id, element)

      registry.set(v.id, {
        marker, popup, element, vehicle: v,
        lat: v.latitude, lng: v.longitude,
        srcLat: v.latitude, srcLng: v.longitude,
        dstLat: v.latitude, dstLng: v.longitude,
      })
    }
  }

  for (const [id, s] of registry) {
    if (!incomingIds.has(id)) {
      s.popup.remove()
      s.marker.remove()
      registry.delete(id)
      if (openId === id) openId = null
    }
  }

  // Refresh the open popup (next stop / destination may have changed)
  const open = openId && registry.get(openId)
  if (open?.popup.isOpen()) open.popup.setHTML(popupHtml(open.vehicle))

  startAnim()
}

/* ------------------------------------------------------------------ */
/*  Lifecycle                                                          */
/* ------------------------------------------------------------------ */
function init(m) {
  m.on('movestart', onBusy)
  m.on('moveend', onIdle)
  if (props.vehicles.length) sync(props.vehicles)
}

onMounted(() => {
  if (map?.value) init(map.value)
  else {
    const stop = watch(() => map?.value, (m) => { if (m) { init(m); stop() } })
  }
})

onBeforeUnmount(() => {
  cancelAnim()
  if (map?.value) {
    map.value.off('movestart', onBusy)
    map.value.off('moveend', onIdle)
  }
  for (const s of registry.values()) {
    s.popup.remove()
    s.marker.remove()
  }
  registry.clear()
})

watch(() => props.vehicles, (v) => sync(v))
// Route data arrives after the first vehicles: refresh an open popup's next stop
watch(() => store.lineRoutes.size, () => {
  const open = openId && registry.get(openId)
  if (open?.popup.isOpen()) open.popup.setHTML(popupHtml(open.vehicle))
})
</script>

<template>
  <!-- Renderless: all markers managed imperatively -->
</template>
