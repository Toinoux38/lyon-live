<script setup>
/**
 * LineRoute - Draws a bus line's route on the MapLibre GL map.
 *
 * Features:
 *  - Decodes Google Encoded Polylines from the TCL API
 *  - Uses MapLibre line layers for route visualization
 *  - Displays terminus pills and stop markers using DOM markers
 */

import { watch, inject, onMounted, onBeforeUnmount } from 'vue'
import maplibregl from 'maplibre-gl'

const props = defineProps({
  routeData: { type: Object, required: true },
  outwardColor: { type: String, default: '#DC2626' },
  returnColor:  { type: String, default: '#F87171' },
  lineId:       { type: String, required: true },
  /** Which directions to render: 'both' | 'outward' | 'return' */
  direction:    { type: String, default: 'both' },
})

const map = inject('maplibreMap')

// Unique source/layer IDs for this component instance
const sourceId = `route-${props.lineId}`
let layerIds = []
let markers = []

/* ------------------------------------------------------------------ */
/*  Polyline decoder                                                    */
/* ------------------------------------------------------------------ */
function decodePolyline(encoded) {
  const points = []
  let index = 0, lat = 0, lng = 0
  while (index < encoded.length) {
    let shift = 0, result = 0, byte
    do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5 } while (byte >= 0x20)
    lat += (result & 1) ? ~(result >> 1) : (result >> 1)
    shift = 0; result = 0
    do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5 } while (byte >= 0x20)
    lng += (result & 1) ? ~(result >> 1) : (result >> 1)
    points.push([lng / 1e5, lat / 1e5]) // GeoJSON: [lng, lat]
  }
  return points
}

/* ------------------------------------------------------------------ */
/*  Get Lucide-style flag SVG for one-way indicator                    */
/* ------------------------------------------------------------------ */
function getFlagSvg() {
  return `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-left:5px;display:inline-block;">
    <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1" />
    <line x1="4" y1="22" x2="4" y2="15" />
  </svg>`
}

/* ------------------------------------------------------------------ */
/*  Create terminus pill DOM element                                    */
/* ------------------------------------------------------------------ */
function createTerminusPill(name, color, isOneWay) {
  const el = document.createElement('div')
  el.className = 'terminus-pill'
  el.innerHTML = `<div style="
    background:${color};
    color:#ffffff;
    border-radius:99px;
    padding:4px 11px;
    font-size:11px;
    font-weight:700;
    white-space:nowrap;
    box-shadow:0 2px 8px rgba(0,0,0,0.28);
    font-family:'Figtree',sans-serif;
    border:1.5px solid rgba(255,255,255,0.35);
    pointer-events:none;
    display:flex;
    align-items:center;
    transform:translate(-50%,-100%);
  ">${name}${isOneWay ? getFlagSvg() : ''}</div>`
  return el
}

/* ------------------------------------------------------------------ */
/*  Create stop marker DOM element                                      */
/* ------------------------------------------------------------------ */
function createStopMarker(color) {
  const el = document.createElement('div')
  el.style.cssText = `
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #ffffff;
    border: 2px solid ${color};
    cursor: pointer;
  `
  return el
}

/* ------------------------------------------------------------------ */
/*  Clear all layers and markers                                        */
/* ------------------------------------------------------------------ */
function clearRoute() {
  if (!map?.value) return

  // Remove layers first
  for (const id of layerIds) {
    if (map.value.getLayer(id)) {
      map.value.removeLayer(id)
    }
  }
  layerIds = []

  // Remove source
  if (map.value.getSource(sourceId)) {
    map.value.removeSource(sourceId)
  }

  // Remove markers
  for (const m of markers) {
    m.remove()
  }
  markers = []
}

/* ------------------------------------------------------------------ */
/*  Draw route                                                          */
/* ------------------------------------------------------------------ */
function drawRoute() {
  if (!map?.value) return

  clearRoute()

  const data = props.routeData
  if (!data) return

  const directions = data.directions || data || []
  const dirArray = Array.isArray(directions) ? directions : [directions]

  // Count how many directions will actually be drawn (respects the direction prop)
  const drawnCount = dirArray.filter((_, i) => {
    if (props.direction === 'outward' && i === 1) return false
    if (props.direction === 'return'  && i === 0) return false
    return true
  }).length

  // Build GeoJSON features for all routes
  const features = []
  let layerIndex = 0

  for (let di = 0; di < dirArray.length; di++) {
    const dir = dirArray[di]
    const isReturn = di === 1

    // Filter based on the direction prop
    if (props.direction === 'outward' && isReturn) continue
    if (props.direction === 'return' && !isReturn) continue

    const color = isReturn ? props.returnColor : props.outwardColor

    // Decode shapes
    let segments = []
    if (dir.shapes && typeof dir.shapes === 'string') {
      segments = [decodePolyline(dir.shapes)]
    } else if (Array.isArray(dir.shapes) && dir.shapes.length > 0) {
      segments = dir.shapes
        .filter((s) => typeof s === 'string')
        .map((s) => decodePolyline(s))
    }

    if (segments.length === 0 && dir.geometry?.coordinates) {
      segments = [dir.geometry.coordinates]
    }

    // Create line features
    for (const coords of segments) {
      if (coords.length < 2) continue
      features.push({
        type: 'Feature',
        properties: {
          color,
          dirIndex: di,
          layerIndex: layerIndex++,
        },
        geometry: {
          type: 'LineString',
          coordinates: coords,
        },
      })
    }

    // Add terminus pill at last stop
    if (dir.stopPoints && dir.stopPoints.length > 0) {
      const stop = dir.stopPoints[dir.stopPoints.length - 1]
      const pos = stop.position || stop
      const lat = pos.latitude ?? pos.lat
      const lng = pos.longitude ?? pos.lon ?? pos.lng
      if (lat && lng) {
        const name = stop.name || stop.label || ''
        const el = createTerminusPill(name, color, drawnCount === 1)
        const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
          .setLngLat([lng, lat])
          .addTo(map.value)
        markers.push(marker)
      }
    }

    // Add stop markers
    if (dir.stopPoints && Array.isArray(dir.stopPoints)) {
      for (const stop of dir.stopPoints) {
        const pos = stop.position || stop
        const lat = pos.latitude ?? pos.lat
        const lng = pos.longitude ?? pos.lon ?? pos.lng
        if (lat && lng) {
          const el = createStopMarker(color)
          const marker = new maplibregl.Marker({ element: el })
            .setLngLat([lng, lat])
            .addTo(map.value)

          // Add popup on click
          const popup = new maplibregl.Popup({
            closeButton: false,
            offset: [0, -5],
          }).setHTML(
            `<span style="font-family:'Figtree',sans-serif;font-size:12px;font-weight:600;">${stop.name || stop.label || ''}</span>`
          )

          el.addEventListener('mouseenter', () => marker.setPopup(popup).togglePopup())
          el.addEventListener('mouseleave', () => popup.remove())

          markers.push(marker)
        }
      }
    }
  }

  if (features.length === 0) return

  // Add GeoJSON source
  map.value.addSource(sourceId, {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features,
    },
  })

  // Add white outline layer (casing)
  const casingLayerId = `${sourceId}-casing`
  map.value.addLayer({
    id: casingLayerId,
    type: 'line',
    source: sourceId,
    layout: {
      'line-join': 'round',
      'line-cap': 'round',
    },
    paint: {
      'line-color': '#ffffff',
      'line-width': 7,
      'line-opacity': 0.85,
    },
  })
  layerIds.push(casingLayerId)

  // Add colored line layer
  const lineLayerId = `${sourceId}-line`
  map.value.addLayer({
    id: lineLayerId,
    type: 'line',
    source: sourceId,
    layout: {
      'line-join': 'round',
      'line-cap': 'round',
    },
    paint: {
      'line-color': ['get', 'color'],
      'line-width': 4,
      'line-opacity': 1,
    },
  })
  layerIds.push(lineLayerId)
}

onMounted(() => {
  if (map?.value) {
    drawRoute()
  } else {
    const stop = watch(
      () => map?.value,
      (m) => {
        if (m) { drawRoute(); stop() }
      },
    )
  }
})

onBeforeUnmount(() => {
  clearRoute()
})

watch(() => props.routeData, drawRoute)
watch(() => props.outwardColor, drawRoute)
watch(() => props.returnColor, drawRoute)
watch(() => props.direction, drawRoute)
</script>

<template>
  <!-- Renderless: manages MapLibre layers/markers imperatively -->
</template>
