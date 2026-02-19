/**
 * Calculate distance between two points in km (Haversine formula)
 */
function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371 // Earth's radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

/**
 * Project a point onto a line segment.
 * Returns the closest point on the segment.
 */
function projectPointOnSegment(lat, lng, lat1, lng1, lat2, lng2) {
  const dx = lng2 - lng1
  const dy = lat2 - lat1
  const lenSq = dx * dx + dy * dy

  if (lenSq === 0) return { lat: lat1, lng: lng1 }

  const t = Math.max(0, Math.min(1, ((lng - lng1) * dx + (lat - lat1) * dy) / lenSq))
  return {
    lat: lat1 + t * dy,
    lng: lng1 + t * dx,
  }
}

/**
 * Find the distance along a route from start to a given point.
 * Returns cumulative distance in km.
 */
function getDistanceAlongRoute(routeCoords, pointLat, pointLng) {
  if (!routeCoords || routeCoords.length < 2) return 0

  let minDist = Infinity
  let closestIdx = 0

  // Find the closest segment to the point
  for (let i = 0; i < routeCoords.length - 1; i++) {
    const lat1 = routeCoords[i][0]
    const lng1 = routeCoords[i][1]
    const lat2 = routeCoords[i + 1][0]
    const lng2 = routeCoords[i + 1][1]

    const proj = projectPointOnSegment(pointLat, pointLng, lat1, lng1, lat2, lng2)
    const dist = haversineDistance(pointLat, pointLng, proj.lat, proj.lng)

    if (dist < minDist) {
      minDist = dist
      closestIdx = i
    }
  }

  // Accumulate distance from start to closest segment
  let distAlongRoute = 0
  for (let i = 0; i < closestIdx; i++) {
    distAlongRoute += haversineDistance(
      routeCoords[i][0],
      routeCoords[i][1],
      routeCoords[i + 1][0],
      routeCoords[i + 1][1],
    )
  }

  // Add partial distance within the closest segment
  const lat1 = routeCoords[closestIdx][0]
  const lng1 = routeCoords[closestIdx][1]
  const lat2 = routeCoords[closestIdx + 1][0]
  const lng2 = routeCoords[closestIdx + 1][1]
  const proj = projectPointOnSegment(pointLat, pointLng, lat1, lng1, lat2, lng2)

  distAlongRoute += haversineDistance(lat1, lng1, proj.lat, proj.lng)

  return distAlongRoute
}

/**
 * Decode polyline from API (Google Encoded Polyline format)
 */
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

/**
 * Calculate the next stop for a vehicle.
 * @param {Object} vehicle - Vehicle object with lat, lng
 * @param {Object} routeData - Full direction data from lineRoutes (includes directions array)
 * @param {String} direction - 'outward' or 'return'
 * @returns {String|null} - Stop name or null if not found
 */
export function calculateNextStop(vehicle, routeData, direction) {
  if (!routeData || !vehicle) return null

  const directions = routeData.directions || [routeData] || []
  const dirArray = Array.isArray(directions) ? directions : [directions]

  // Pick the right direction (0 = outward, 1 = return)
  const dirIndex = direction === 'return' ? 1 : 0
  if (dirIndex >= dirArray.length) return null

  const dir = dirArray[dirIndex]
  if (!dir.stopPoints || dir.stopPoints.length === 0) return null

  // Decode route geometry
  let routeCoords = []
  if (dir.shapes && typeof dir.shapes === 'string') {
    routeCoords = decodePolyline(dir.shapes)
  } else if (Array.isArray(dir.shapes) && dir.shapes.length > 0) {
    routeCoords = dir.shapes
      .filter(s => typeof s === 'string')
      .flatMap(s => decodePolyline(s))
  } else if (dir.geometry?.coordinates) {
    routeCoords = dir.geometry.coordinates.map(c => [c[1], c[0]])
  }

  if (routeCoords.length < 2) return null

  // Get distance of vehicle along route
  const vehicleDist = getDistanceAlongRoute(routeCoords, vehicle.latitude, vehicle.longitude)

  // Calculate distance to each stop from start of route
  let nextStop = null
  let minDistToNext = Infinity

  for (const stop of dir.stopPoints) {
    const stopLat = stop.lat ?? stop.latitude
    const stopLng = stop.lon ?? stop.longitude
    if (!stopLat || !stopLng) continue

    // Distance from route start to this stop
    const stopDist = getDistanceAlongRoute(routeCoords, stopLat, stopLng)

    // Find the closest stop ahead of the vehicle (with small buffer)
    const distToStop = stopDist - vehicleDist
    if (distToStop > -0.1 && distToStop < minDistToNext) {
      minDistToNext = distToStop
      nextStop = stop.name || stop.label || '?'
    }
  }

  return nextStop
}
