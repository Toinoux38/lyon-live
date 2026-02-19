/**
 * TCL Lyon API client.
 *
 * All requests are proxied through Vite's dev server to avoid CORS issues.
 * The proxy rewrites /api -> /InstantCore/v3 and injects the X-API-Key header.
 */

const BASE = '/api'
const NETWORK_ID = 57

/**
 * Generate a random UUID v4 for session headers.
 */
function uuid() {
  return crypto.randomUUID()
}

/** Lazily initialized per-session identifiers. */
let applicationId = null
let sessionId = null

function getSessionHeaders() {
  if (!applicationId) applicationId = uuid()
  if (!sessionId) sessionId = uuid()
  return {
    'Application-Id': applicationId,
    'Session-Id': sessionId,
  }
}

/**
 * Perform a GET request against the TCL API.
 * @param {string} path - Path relative to /networks/{networkId}/
 * @param {Record<string, string>} [params] - Query parameters
 * @returns {Promise<any>}
 */
async function get(path, params = {}) {
  const url = new URL(`${BASE}/networks/${NETWORK_ID}/${path}`, window.location.origin)

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value))
    }
  }

  const response = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json',
      ...getSessionHeaders(),
    },
  })

  if (!response.ok) {
    throw new Error(`TCL API ${response.status}: ${response.statusText}`)
  }

  return response.json()
}

/**
 * Fetch all lines on the network.
 * Returns the raw array from the API `{ lines: [...] }`.
 * @returns {Promise<Array>}
 */
export async function fetchLines() {
  const data = await get('lines/')
  return data.lines ?? []
}

/**
 * Fetch real-time vehicle positions for the given line IDs.
 * Queries both outward and return directions and merges the results.
 *
 * @param {string[]} lineIds - Array of full line IDs (e.g. "line:SYTNEX:C1")
 * @returns {Promise<Array<{ id: string, mode: string, bearing: number, latitude: number, longitude: number, direction: string }>>}
 */
export async function fetchVehiclePositions(lineIds) {
  if (!lineIds.length) return []

  // Fetch each line SEPARATELY so we can reliably tag every vehicle with the
  // lineId it came from. A single combined request (lineIdsOutward: "C1,C13")
  // returns a flat array with no per-vehicle line info — forcing the caller to
  // guess via string matching, which breaks for prefix overlaps (C1 vs C13).
  const requests = lineIds.flatMap((lineId) => [
    get('lines/vehicleMonitoring', { lineIdsOutward: lineId })
      .then((list) =>
        (Array.isArray(list) ? list : []).map((v) => ({ ...v, lineId, direction: 'outward' })),
      )
      .catch(() => []),
    get('lines/vehicleMonitoring', { lineIdsReturn: lineId })
      .then((list) =>
        (Array.isArray(list) ? list : []).map((v) => ({ ...v, lineId, direction: 'return' })),
      )
      .catch(() => []),
  ])

  const results = await Promise.all(requests)
  return results.flat()
}

/**
 * Fetch directions (route geometry + stop points) for a line.
 * @param {string} lineId - Full line ID (e.g. "line:SYTNEX:C13")
 * @returns {Promise<Object>}
 */
export async function fetchLineDirections(lineId) {
  return get(`lines/${lineId}/directions`, { stopPoints: 'true' })
}

/**
 * Fetch information about a single line.
 * @param {string} lineId - Full line ID (e.g. "line:SYTNEX:C13")
 * @returns {Promise<Object>}
 */
export async function fetchLineInfo(lineId) {
  const data = await get(`lines/${lineId}/`)
  return data.lines?.[0] ?? null
}
