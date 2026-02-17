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
  returnColor: { type: String, default: '#F87171' },
  lineId: { type: String, required: true },
})

const map = inject('leafletMap')
let layerGroup = null
let zoomHandler = null

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
/*  Draw route                                                          */
/* ------------------------------------------------------------------ */
function drawRoute() {
  if (!map?.value) return
  clearRoute()
  layerGroup = L.layerGroup().addTo(map.value)

  const data = props.routeData
  if (!data) return

  const directions = data.directions || data || []
  const dirArray = Array.isArray(directions) ? directions : [directions]

  // Compute offset in meters from a fixed pixel size at current zoom
  const OFFSET_PX = 5 // pixels of lateral separation
  const m = map.value
  const zoom = m.getZoom()
  const center = m.getCenter()
  const offsetMeters = pixelsToMeters(OFFSET_PX, center.lat, zoom)

  for (let di = 0; di < dirArray.length; di++) {
    const dir = dirArray[di]
    const isReturn = di === 1
    const color = isReturn ? props.returnColor : props.outwardColor
    const offsetSign = isReturn ? 1 : -1

    let coords = null

    // Decode shapes
    if (dir.shapes && typeof dir.shapes === 'string') {
      coords = decodePolyline(dir.shapes)
    } else if (Array.isArray(dir.shapes) && dir.shapes.length > 0) {
      coords = dir.shapes.flatMap((s) => typeof s === 'string' ? decodePolyline(s) : [])
    }
    if (!coords && dir.geometry && dir.geometry.coordinates) {
      coords = dir.geometry.coordinates.map((c) => [c[1], c[0]])
    }

    if (coords && coords.length > 1) {
      // Offset so outward and return don't overlap (zoom-adaptive)
      const offset = dirArray.length > 1 ? offsetLine(coords, offsetMeters * offsetSign) : coords

      // White outline
      L.polyline(offset, {
        color: '#ffffff',
        weight: 7,
        opacity: 0.85,
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(layerGroup)

      // Colored line
      L.polyline(offset, {
        color: color,
        weight: 4,
        opacity: 1,
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(layerGroup)

      // Direction arrows (only for single-direction lines)
      if (dirArray.length === 1) {
        addArrows(offset, color, layerGroup)
      }
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
            color: color,
            fillColor: '#ffffff',
            fillOpacity: 1,
            weight: 1.5,
            opacity: 0.7,
          })
            .bindPopup(
              `<span style="font-family:'Figtree',sans-serif;font-size:12px;font-weight:600;">${stop.name || stop.label || ''}</span>`,
              { closeButton: false, offset: [0, -2] },
            )
            .addTo(layerGroup)
        }
      }
    }
  }
}

function clearRoute() {
  if (layerGroup && map?.value) {
    map.value.removeLayer(layerGroup)
    layerGroup = null
  }
}

onMounted(() => {
  drawRoute()
  // Redraw on zoom so offset spacing stays consistent in pixels
  if (map?.value) {
    zoomHandler = () => drawRoute()
    map.value.on('zoomend', zoomHandler)
  }
})

onBeforeUnmount(() => {
  if (map?.value && zoomHandler) {
    map.value.off('zoomend', zoomHandler)
  }
  clearRoute()
})

watch(() => props.routeData, drawRoute, { deep: true })
watch(() => props.outwardColor, drawRoute)
watch(() => props.returnColor, drawRoute)
</script>

<template>
  <!-- Renderless: manages Leaflet polylines/circles imperatively -->
</template>
