<script setup>
/**
 * LineRoute - Draws a bus line's route on the Leaflet map.
 *
 * Features:
 *  - Decodes Google Encoded Polylines from the TCL API
 *  - Offsets outward/return lines with zoom-adaptive pixel spacing
 *  - Uses different colors for outward vs return
 *  - Draws directional arrow markers along the line (rotation baked into SVG)
 */

import { watch, inject, onMounted, onBeforeUnmount } from 'vue'
import L from 'leaflet'

const props = defineProps({
  routeData: { type: Object, required: true },
  outwardColor: { type: String, default: '#DC2626' },
  returnColor:  { type: String, default: '#F87171' },
  lineId:       { type: String, required: true },
  /** Which directions to render: 'both' | 'outward' | 'return' */
  direction:    { type: String, default: 'both' },
})

const map = inject('leafletMap')
let layerGroup = null
let zoomHandler = null
let zoomDebounceTimer = null

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
    points.push([lat / 1e5, lng / 1e5])
  }
  return points
}

/* ------------------------------------------------------------------ */
/*  Convert pixels to meters at a given lat/zoom                        */
/* ------------------------------------------------------------------ */
function pixelsToMeters(px, lat, zoom) {
  const metersPerPixel = (156543.03 * Math.cos(lat * Math.PI / 180)) / Math.pow(2, zoom)
  return px * metersPerPixel
}

/* ------------------------------------------------------------------ */
/*  Offset a polyline laterally by meters                               */
/* ------------------------------------------------------------------ */
function offsetLine(coords, meters) {
  if (coords.length < 2 || meters === 0) return coords
  const result = []
  for (let i = 0; i < coords.length; i++) {
    const prev = coords[Math.max(0, i - 1)]
    const next = coords[Math.min(coords.length - 1, i + 1)]
    const dlat = next[0] - prev[0]
    const dlng = next[1] - prev[1]
    const len = Math.sqrt(dlat * dlat + dlng * dlng)
    if (len === 0) { result.push(coords[i]); continue }
    const nlat = -dlng / len
    const nlng = dlat / len
    const latRad = coords[i][0] * Math.PI / 180
    const mPerDegLat = 111320
    const mPerDegLng = 111320 * Math.cos(latRad)
    result.push([
      coords[i][0] + nlat * meters / mPerDegLat,
      coords[i][1] + nlng * meters / mPerDegLng,
    ])
  }
  return result
}

/* ------------------------------------------------------------------ */
/*  Compute readable text color for a given hex background color        */
/* ------------------------------------------------------------------ */
function pillTextColor(hex) {
  // Always white for better readability and contrast
  return '#ffffff'
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
/*  Draw a terminus pill DivIcon at the last stop of a direction        */
/* ------------------------------------------------------------------ */
function addTerminusPill(stopPoints, color, group, isOneWay) {
  if (!stopPoints || stopPoints.length === 0) return
  const stop = stopPoints[stopPoints.length - 1]
  const pos  = stop.position || stop
  const lat  = pos.latitude  ?? pos.lat
  const lng  = pos.longitude ?? pos.lon ?? pos.lng
  if (!lat || !lng) return

  const name      = stop.name || stop.label || ''
  const textColor = '#ffffff'
  const flagHtml  = isOneWay ? getFlagSvg() : ''

  const icon = L.divIcon({
    className: '',
    html: `<div style="
      position:relative;width:0;height:0;"><div style="
      position:absolute;
      transform:translate(-50%,-110%);
      background:${color};
      color:${textColor};
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
    ">${name}${flagHtml}</div></div>`,
    iconSize:   [0, 0],
    iconAnchor: [0, 0],
  })

  L.marker([lat, lng], { icon, interactive: false, keyboard: false }).addTo(group)
}

/* ------------------------------------------------------------------ */
/*  Direction arrow markers along a polyline                            */
/*  Rotation is baked into the SVG so Leaflet can't overwrite it.       */
/* ------------------------------------------------------------------ */
function addArrows(coords, color, group) {
  if (coords.length < 2) return

  const SPACING = 800 // meters between arrows
  let accumulated = 0

  for (let i = 1; i < coords.length; i++) {
    const lat1 = coords[i - 1][0], lng1 = coords[i - 1][1]
    const lat2 = coords[i][0], lng2 = coords[i][1]
    const dlat = (lat2 - lat1) * 111320
    const dlng = (lng2 - lng1) * 111320 * Math.cos(lat1 * Math.PI / 180)
    const segLen = Math.sqrt(dlat * dlat + dlng * dlng)

    accumulated += segLen

    if (accumulated >= SPACING) {
      accumulated = 0
      // Bearing: atan2(east, north) gives clockwise angle from north
      const bearing = Math.atan2(dlng, dlat) * 180 / Math.PI
      const midLat = (lat1 + lat2) / 2
      const midLng = (lng1 + lng2) / 2

      // Bake rotation into the SVG itself so map pan/zoom can't wipe it
      const icon = L.divIcon({
        className: 'route-arrow',
        html: `<svg width="14" height="14" viewBox="0 0 14 14" style="transform:rotate(${bearing}deg);display:block;"><path d="M3 11L7 3L11 11" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.75"/></svg>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      })

      L.marker([midLat, midLng], {
        icon: icon,
        interactive: false,
        keyboard: false,
      }).addTo(group)
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Draw a single coord array as an offset polyline                     */
/* ------------------------------------------------------------------ */
function drawSegment(coords, color, offsetMeters, layerGrp) {
  if (!coords || coords.length < 2) return
  const offset = offsetMeters !== 0 ? offsetLine(coords, offsetMeters) : coords

  L.polyline(offset, {
    color: '#ffffff',
    weight: 7,
    opacity: 0.85,
    lineCap: 'round',
    lineJoin: 'round',
  }).addTo(layerGrp)

  L.polyline(offset, {
    color,
    weight: 4,
    opacity: 1,
    lineCap: 'round',
    lineJoin: 'round',
  }).addTo(layerGrp)
}

/* ------------------------------------------------------------------ */
/*  Draw route                                                          */
/* ------------------------------------------------------------------ */
function drawRoute() {
  if (!map?.value) return

  // Build the NEW group on the map first, then swap — zero flicker on zoom.
  const newGroup = L.layerGroup().addTo(map.value)

  const data = props.routeData
  if (!data) {
    if (layerGroup) map.value.removeLayer(layerGroup)
    layerGroup = newGroup
    return
  }

  const directions = data.directions || data || []
  const dirArray = Array.isArray(directions) ? directions : [directions]

  const OFFSET_PX = 5
  const m = map.value
  const offsetMeters = pixelsToMeters(OFFSET_PX, m.getCenter().lat, m.getZoom())

  // Count how many directions will actually be drawn (respects the direction prop)
  const drawnCount = dirArray.filter((_, i) => {
    if (props.direction === 'outward' && i === 1) return false
    if (props.direction === 'return'  && i === 0) return false
    return true
  }).length

  for (let di = 0; di < dirArray.length; di++) {
    const dir      = dirArray[di]
    const isReturn = di === 1

    // Filter based on the direction prop
    if (props.direction === 'outward' && isReturn)  continue
    if (props.direction === 'return'  && !isReturn) continue

    const color = isReturn ? props.returnColor : props.outwardColor
    // Only offset when BOTH directions are drawn; otherwise draw centered
    const effectiveOffset = drawnCount > 1 ? offsetMeters * (isReturn ? 1 : -1) : 0

    // ── Decode shapes ───────────────────────────────────────────────────────
    // dir.shapes may be a single encoded string OR an array of separate strings.
    // Each array entry is an INDEPENDENT segment (gap in service, loop, branch).
    // We must draw them as individual polylines — flatMap-ing would join them with
    // a straight "teleport" spike between disconnected endpoints.
    let segments = []

    if (dir.shapes && typeof dir.shapes === 'string') {
      segments = [decodePolyline(dir.shapes)]
    } else if (Array.isArray(dir.shapes) && dir.shapes.length > 0) {
      segments = dir.shapes
        .filter((s) => typeof s === 'string')
        .map((s) => decodePolyline(s))
    }

    if (segments.length === 0 && dir.geometry?.coordinates) {
      segments = [dir.geometry.coordinates.map((c) => [c[1], c[0]])]
    }

    // Draw each segment independently — never bridge them together
    for (const coords of segments) {
      drawSegment(coords, color, effectiveOffset, newGroup)
    }

    // Direction arrows — placed along the flattened path (gaps OK for arrows)
    if (drawnCount === 1 && segments.length > 0) {
      addArrows(segments.flat(), color, newGroup)
    }

    // Terminus pill label at the last stop of this direction
    if (dir.stopPoints && dir.stopPoints.length > 0) {
      const isOneWay = drawnCount === 1
      addTerminusPill(dir.stopPoints, color, newGroup, isOneWay)
    }

    // Stop markers
    if (dir.stopPoints && Array.isArray(dir.stopPoints)) {
      for (const stop of dir.stopPoints) {
        const pos = stop.position || stop
        const lat = pos.latitude ?? pos.lat
        const lng = pos.longitude ?? pos.lon ?? pos.lng
        if (lat && lng) {
          L.circleMarker([lat, lng], {
            radius: 3,
            color,
            fillColor: '#ffffff',
            fillOpacity: 1,
            weight: 1.5,
            opacity: 0.7,
          })
            .bindPopup(
              `<span style="font-family:'Figtree',sans-serif;font-size:12px;font-weight:600;">${stop.name || stop.label || ''}</span>`,
              { closeButton: false, offset: [0, -2] },
            )
            .addTo(newGroup)
        }
      }
    }
  }

  // Atomic swap: only remove old group AFTER new one is fully drawn on screen
  if (layerGroup) map.value.removeLayer(layerGroup)
  layerGroup = newGroup
}

function clearRoute() {
  if (layerGroup && map?.value) {
    map.value.removeLayer(layerGroup)
    layerGroup = null
  }
}

onMounted(() => {
  drawRoute()
  // Debounced redraw on zoom so offset spacing stays consistent in pixels
  // without redrawing on every intermediate zoomend step during rapid gestures
  if (map?.value) {
    zoomHandler = () => {
      clearTimeout(zoomDebounceTimer)
      zoomDebounceTimer = setTimeout(() => drawRoute(), 150)
    }
    map.value.on('zoomend', zoomHandler)
  }
})

onBeforeUnmount(() => {
  clearTimeout(zoomDebounceTimer)
  if (map?.value && zoomHandler) {
    map.value.off('zoomend', zoomHandler)
  }
  clearRoute()
})

// Route data is replaced wholesale by the store — shallow identity watch is sufficient
watch(() => props.routeData,   drawRoute)
watch(() => props.outwardColor, drawRoute)
watch(() => props.returnColor,  drawRoute)
watch(() => props.direction,    drawRoute)
</script>

<template>
  <!-- Renderless: manages Leaflet polylines/circles imperatively -->
</template>
