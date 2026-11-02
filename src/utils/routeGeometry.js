/**
 * routeGeometry.js
 *
 * Normalises the `/lines/{id}/directions?stopPoints=true` payload into a
 * shape the map layers can use directly, and pre-computes everything needed
 * for "next stop" lookups so per-vehicle work is a single projection.
 *
 * API shape (verified): { directions: [{ direction: 'OUTWARD'|'RETURN',
 *   display: '<headsign>', stopPoints: [{ id, name, lat, lon, stopArea }],
 *   shapes: [<encoded polyline>, …] }] }
 */

/** Decode a Google encoded polyline into GeoJSON [lng, lat] pairs. */
export function decodePolyline(encoded) {
  const points = []
  let index = 0, lat = 0, lng = 0
  while (index < encoded.length) {
    let shift = 0, result = 0, byte
    do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5 } while (byte >= 0x20)
    lat += (result & 1) ? ~(result >> 1) : (result >> 1)
    shift = 0; result = 0
    do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5 } while (byte >= 0x20)
    lng += (result & 1) ? ~(result >> 1) : (result >> 1)
    points.push([lng / 1e5, lat / 1e5])
  }
  return points
}

/* ------------------------------------------------------------------ */
/*  Fast local planar distance (km) — plenty accurate at city scale    */
/* ------------------------------------------------------------------ */
const KM_PER_DEG_LAT = 110.574
const KM_PER_DEG_LNG = 111.320 * Math.cos((45.76 * Math.PI) / 180) // Lyon

function toXY(lng, lat) {
  return [lng * KM_PER_DEG_LNG, lat * KM_PER_DEG_LAT]
}

/** Project a point on a polyline (already in km XY). Returns distance along it. */
function alongDistance(xy, cum, px, py) {
  let best = Infinity
  let bestAlong = 0
  for (let i = 0; i < xy.length - 1; i++) {
    const [x1, y1] = xy[i]
    const [x2, y2] = xy[i + 1]
    const dx = x2 - x1, dy = y2 - y1
    const lenSq = dx * dx + dy * dy
    const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq))
    const qx = x1 + t * dx, qy = y1 + t * dy
    const d = (px - qx) ** 2 + (py - qy) ** 2
    if (d < best) {
      best = d
      bestAlong = cum[i] + Math.sqrt(lenSq) * t
    }
  }
  return bestAlong
}

/**
 * Douglas–Peucker simplification of a [lng, lat] line, tolerance in km.
 * The API shapes are dense and slightly noisy; `line-offset` on the map
 * amplifies every zigzag into a visible bulge, so we smooth them once here.
 */
function simplify(coords, toleranceKm = 0.003) {
  if (coords.length < 3) return coords
  const xy = coords.map(([lng, lat]) => toXY(lng, lat))
  const keep = new Uint8Array(coords.length)
  keep[0] = keep[coords.length - 1] = 1
  const tolSq = toleranceKm * toleranceKm
  const stack = [[0, coords.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()
    const [ax, ay] = xy[a], [bx, by] = xy[b]
    const dx = bx - ax, dy = by - ay
    const lenSq = dx * dx + dy * dy
    let maxD = -1, idx = -1
    for (let i = a + 1; i < b; i++) {
      const [px, py] = xy[i]
      const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq))
      const d = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2
      if (d > maxD) { maxD = d; idx = i }
    }
    if (maxD > tolSq) {
      keep[idx] = 1
      stack.push([a, idx], [idx, b])
    }
  }
  return coords.filter((_, i) => keep[i])
}

/* ------------------------------------------------------------------ */
/*  Direction parsing                                                  */
/* ------------------------------------------------------------------ */
function parseStop(s) {
  const pos = s.position || s
  const lat = pos.latitude ?? pos.lat
  const lng = pos.longitude ?? pos.lon ?? pos.lng
  if (typeof lat !== 'number' || typeof lng !== 'number') return null
  return {
    id: s.id,
    areaId: s.stopArea?.id ?? s.id,
    name: s.name || s.label || '',
    lat,
    lng,
  }
}

function parseDirection(dir) {
  let segments = []
  if (typeof dir.shapes === 'string') {
    segments = [decodePolyline(dir.shapes)]
  } else if (Array.isArray(dir.shapes)) {
    segments = dir.shapes.filter((s) => typeof s === 'string').map(decodePolyline)
  }
  if (segments.length === 0 && dir.geometry?.coordinates) {
    segments = [dir.geometry.coordinates]
  }
  segments = segments.filter((c) => c.length >= 2).map((c) => simplify(c))

  const stops = (dir.stopPoints || []).map(parseStop).filter(Boolean)

  // Progress along a direction is measured on the ordered *stop sequence*,
  // not on `shapes`: when there are several shapes they are alternative
  // full-length variants (e.g. T1 has two, both starting at Debourg), so
  // concatenating them produces nonsense distances. Stops are ~400 m apart,
  // so straight stop-to-stop segments are an accurate enough backbone.
  const xy = stops.map((s) => toXY(s.lng, s.lat))
  const cum = [0]
  for (let i = 1; i < xy.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]))
  }

  return {
    headsign: dir.display || stops[stops.length - 1]?.name || '',
    segments,
    stops,
    _xy: xy,
    _cum: cum,
  }
}

const parsedCache = new WeakMap()

/**
 * @param {Object} routeData – raw directions payload
 * @returns {{ outward: Object|null, return: Object|null }}
 */
export function parseRoute(routeData) {
  if (!routeData || typeof routeData !== 'object') return { outward: null, return: null }
  const cached = parsedCache.get(routeData)
  if (cached) return cached

  const raw = routeData.directions ?? routeData
  const dirs = Array.isArray(raw) ? raw : [raw]
  const result = { outward: null, return: null }

  dirs.forEach((dir, i) => {
    // Prefer the explicit flag; fall back to array order (0 = outward)
    const key = dir.direction === 'RETURN' ? 'return'
      : dir.direction === 'OUTWARD' ? 'outward'
      : (i === 1 ? 'return' : 'outward')
    if (!result[key]) result[key] = parseDirection(dir)
  })

  parsedCache.set(routeData, result)
  return result
}

/**
 * Next stop ahead of a vehicle on its direction, or null.
 * @param {{ latitude: number, longitude: number }} vehicle
 * @param {Object} routeData – raw directions payload
 * @param {'outward'|'return'} direction
 */
export function calculateNextStop(vehicle, routeData, direction) {
  if (!vehicle || !routeData) return null
  const dir = parseRoute(routeData)[direction === 'return' ? 'return' : 'outward']
  if (!dir || dir._xy.length < 2) return dir?.stops[0]?.name ?? null

  const vAlong = alongDistance(dir._xy, dir._cum, ...toXY(vehicle.longitude, vehicle.latitude))
  // 30 m buffer: a vehicle sitting at a stop still shows that stop
  for (let i = 0; i < dir.stops.length; i++) {
    if (dir._cum[i] >= vAlong - 0.03) return dir.stops[i].name
  }
  return dir.stops[dir.stops.length - 1].name
}

/** Bounding box [[minLng, minLat], [maxLng, maxLat]] of a route, or null. */
export function routeBounds(routeData) {
  const { outward, return: ret } = parseRoute(routeData)
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity
  for (const dir of [outward, ret]) {
    if (!dir) continue
    for (const seg of dir.segments) {
      for (const [lng, lat] of seg) {
        if (lng < minLng) minLng = lng
        if (lng > maxLng) maxLng = lng
        if (lat < minLat) minLat = lat
        if (lat > maxLat) maxLat = lat
      }
    }
  }
  return Number.isFinite(minLng) ? [[minLng, minLat], [maxLng, maxLat]] : null
}

/** Escape a string for safe interpolation into HTML. */
export function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]))
}
