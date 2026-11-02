<script setup>
/**
 * LineRoute – draws one selected line on the MapLibre map (renderless).
 *
 *  - Route: casing + colored line, inserted *below* the basemap labels.
 *    When both directions are shown each one is offset to its right-hand side
 *    so outward and return run side by side instead of hiding each other.
 *  - Stops: GPU circle layer (not DOM markers) + names from zoom 14.5.
 *  - Terminus: one DOM pill per displayed direction, showing the headsign.
 */

import { watch, inject, onMounted, onBeforeUnmount } from 'vue'
import maplibregl from 'maplibre-gl'
import { parseRoute, escapeHtml } from '@/utils/routeGeometry'

const props = defineProps({
  routeData:    { type: Object, required: true },
  lineId:       { type: String, required: true },
  outwardColor: { type: String, default: '#DC2626' },
  returnColor:  { type: String, default: '#F87171' },
  /** Which directions to render: 'both' | 'outward' | 'return' */
  direction:    { type: String, default: 'both' },
  /** Trams get a slightly heavier line */
  isTram:       { type: Boolean, default: false },
})

const map = inject('maplibreMap')

const ns = `route-${props.lineId}`
const LINE_SRC = `${ns}-lines`
const STOP_SRC = `${ns}-stops`
const CASING   = `${ns}-casing`
const LINE     = `${ns}-line`
const STOPS    = `${ns}-stops`
const LABELS   = `${ns}-labels`

let terminusMarkers = []
let stopPopup = null
let mounted = false

const hoverCapable = window.matchMedia?.('(hover: hover)').matches ?? true

/* ------------------------------------------------------------------ */
/*  DOM helpers                                                        */
/* ------------------------------------------------------------------ */
const FLAG_SVG = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1"/><line x1="4" y1="22" x2="4" y2="15"/></svg>`

function createTerminusPill(name, color) {
  const el = document.createElement('div')
  el.className = 'terminus-pill'
  el.style.setProperty('--pill-color', color)
  el.innerHTML = `${FLAG_SVG}<span>${escapeHtml(name)}</span>`
  return el
}

/** First symbol layer of the basemap: routes go below it, under the labels. */
function firstBasemapSymbolId(m) {
  return m.getStyle().layers.find((l) => l.type === 'symbol' && !l.id.startsWith('route-'))?.id
}

/* ------------------------------------------------------------------ */
/*  Stop interactions                                                  */
/* ------------------------------------------------------------------ */
function showStopPopup(e) {
  const f = e.features?.[0]
  if (!f) return
  stopPopup ??= new maplibregl.Popup({
    closeButton: false,
    offset: 8,
    className: 'stop-popup',
    focusAfterOpen: false,
  })
  stopPopup
    .setLngLat(f.geometry.coordinates)
    .setHTML(`<span class="stop-popup__name">${escapeHtml(f.properties.name)}</span>`)
    .addTo(map.value)
}
function hideStopPopup() { stopPopup?.remove() }
function onStopEnter(e) { map.value.getCanvas().style.cursor = 'pointer'; if (hoverCapable) showStopPopup(e) }
function onStopLeave() { map.value.getCanvas().style.cursor = ''; if (hoverCapable) hideStopPopup() }
function onStopClick(e) { showStopPopup(e) }

function bindStopEvents(m) {
  m.on('mouseenter', STOPS, onStopEnter)
  m.on('mouseleave', STOPS, onStopLeave)
  m.on('click', STOPS, onStopClick)
}
function unbindStopEvents(m) {
  m.off('mouseenter', STOPS, onStopEnter)
  m.off('mouseleave', STOPS, onStopLeave)
  m.off('click', STOPS, onStopClick)
}

/* ------------------------------------------------------------------ */
/*  Build GeoJSON                                                      */
/* ------------------------------------------------------------------ */
function buildData() {
  const parsed = parseRoute(props.routeData)
  const wanted = props.direction === 'both' ? ['outward', 'return'] : [props.direction]
  const shown = wanted.filter((k) => parsed[k])
  const sideBySide = shown.length === 2

  const lines = []
  const stops = []
  const termini = []
  const seenLabels = new Set()

  for (const key of shown) {
    const dir = parsed[key]
    const color = key === 'return' ? props.returnColor : props.outwardColor

    for (const coords of dir.segments) {
      lines.push({
        type: 'Feature',
        properties: { color, offset: sideBySide ? 1 : 0 },
        geometry: { type: 'LineString', coordinates: coords },
      })
    }

    for (const s of dir.stops) {
      // One label per stop area, even though each direction has its own platform
      const label = seenLabels.has(s.areaId) ? '' : s.name
      seenLabels.add(s.areaId)
      stops.push({
        type: 'Feature',
        properties: { color, name: s.name, label },
        geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
      })
    }

    const last = dir.stops[dir.stops.length - 1]
    if (last) termini.push({ name: dir.headsign || last.name, color, lngLat: [last.lng, last.lat] })
  }

  return {
    lines: { type: 'FeatureCollection', features: lines },
    stops: { type: 'FeatureCollection', features: stops },
    termini,
  }
}

/* ------------------------------------------------------------------ */
/*  Add / update / remove                                              */
/* ------------------------------------------------------------------ */
function addLayers(m) {
  const before = firstBasemapSymbolId(m)
  const w = props.isTram ? 1.25 : 1
  const width = ['interpolate', ['linear'], ['zoom'], 11, 2.5 * w, 14, 4 * w, 17, 7 * w]
  const casingWidth = ['interpolate', ['linear'], ['zoom'], 11, 5 * w, 14, 7.5 * w, 17, 12 * w]
  // offset is a 0/1 flag: shift each direction to its right by ~half a line width
  // (MapLibre requires `zoom` to be the top-level input, so the flag goes inside each stop)
  const off = (px) => ['*', ['get', 'offset'], px]
  const offset = ['interpolate', ['linear'], ['zoom'], 11, off(1.5), 14, off(2.5), 17, off(4)]

  m.addLayer({
    id: CASING, type: 'line', source: LINE_SRC,
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': '#ffffff', 'line-width': casingWidth, 'line-opacity': 0.9, 'line-offset': offset },
  }, before)

  m.addLayer({
    id: LINE, type: 'line', source: LINE_SRC,
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': ['get', 'color'], 'line-width': width, 'line-offset': offset },
  }, before)

  m.addLayer({
    id: STOPS, type: 'circle', source: STOP_SRC,
    minzoom: 11.5,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 11.5, 2, 14, 3.5, 17, 5.5],
      'circle-color': '#ffffff',
      'circle-stroke-color': ['get', 'color'],
      'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 11.5, 1.2, 14, 2, 17, 2.5],
    },
  })

  m.addLayer({
    id: LABELS, type: 'symbol', source: STOP_SRC,
    minzoom: 14.5,
    filter: ['!=', ['get', 'label'], ''],
    layout: {
      'text-field': ['get', 'label'],
      'text-font': ['Noto Sans Bold'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 14.5, 10.5, 17, 12.5],
      'text-anchor': 'left',
      'text-offset': [0.8, 0],
      'text-max-width': 9,
      'text-optional': true,
    },
    paint: {
      'text-color': '#3a3a3c',
      'text-halo-color': 'rgba(255,255,255,0.95)',
      'text-halo-width': 1.6,
    },
  })
}

function render() {
  const m = map?.value
  if (!m || !mounted) return
  const data = buildData()

  if (m.getSource(LINE_SRC)) {
    m.getSource(LINE_SRC).setData(data.lines)
    m.getSource(STOP_SRC).setData(data.stops)
  } else {
    m.addSource(LINE_SRC, { type: 'geojson', data: data.lines })
    m.addSource(STOP_SRC, { type: 'geojson', data: data.stops })
    addLayers(m)
    bindStopEvents(m)
  }

  for (const mk of terminusMarkers) mk.remove()
  terminusMarkers = data.termini.map((t) =>
    new maplibregl.Marker({ element: createTerminusPill(t.name, t.color), anchor: 'bottom', offset: [0, -6] })
      .setLngLat(t.lngLat)
      .addTo(m),
  )
}

function clear() {
  const m = map?.value
  for (const mk of terminusMarkers) mk.remove()
  terminusMarkers = []
  stopPopup?.remove()
  if (!m || !m.style) return
  unbindStopEvents(m)
  for (const id of [LABELS, STOPS, LINE, CASING]) if (m.getLayer(id)) m.removeLayer(id)
  for (const id of [STOP_SRC, LINE_SRC]) if (m.getSource(id)) m.removeSource(id)
}

/** Colors / tram weight are baked into layer paint, so rebuild layers fully. */
function rebuild() {
  clear()
  render()
}

onMounted(() => {
  mounted = true
  if (map?.value) render()
})

onBeforeUnmount(() => {
  mounted = false
  clear()
})

watch(() => map?.value, (m) => { if (m) render() })
watch(() => [props.routeData, props.direction, props.outwardColor, props.returnColor], render)
watch(() => props.isTram, rebuild)
</script>

<template>
  <!-- Renderless: manages MapLibre layers/markers imperatively -->
</template>
