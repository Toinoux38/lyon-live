/**
 * lineGroup.js
 *
 * Classifies TCL lines into display groups and splits the short name into a
 * (prefix, number) pair for the two-part badge.
 *
 * Real API data (network 57) — note that trambus lines come back with
 * `mode: 'TRAM'`, there is no 'TRAMBUS' mode:
 *
 *   commercial_mode:tramway       T1…T7          → tram     "T | 1"
 *   commercial_mode:tramnstadium  TS             → tram     "T | S"
 *   commercial_mode:trambus       TB11, TB12     → trambus  "TB | 11"
 *   commercial_mode:busc          C1…C26         → busc     "C | 13"
 *   commercial_mode:bus           2, 38, A32…    → bus      "BUS | 38"
 *   commercial_mode:buspl         PL1…PL4        → special  "PL | 1"  (night)
 *   commercial_mode:busnav        N181…          → special  "N | 181"
 *   commercial_mode:busr*         BRMB, BR60…    → special  "R | MB"
 *   commercial_mode:busjd         JD300…         → busjd    "JD | 300"
 */

/** Ordered list of group keys (controls section order in UI). */
export const GROUP_ORDER = ['tram', 'trambus', 'busc', 'bus', 'special', 'busjd']

export const GROUP_LABELS = {
  tram:    'Tramway',
  trambus: 'Trambus',
  busc:    'Lignes C',
  bus:     'Bus',
  special: 'Night, shuttles & relays',
  busjd:   'Junior Direct (school)',
}

/** Groups that count as "tram" for the mode filter + map markers. */
const TRAM_GROUPS = new Set(['tram', 'trambus'])

/** Lines we deliberately hide: Rhônexpress isn't run by TCL and has no live data. */
const HIDDEN_LINE_IDS = new Set(['line:SYTNEX:RX'])

const TCL_RED = '#E30613'

function strip(sName, re) {
  const rest = sName.replace(re, '')
  return rest || sName
}

/**
 * Display information for a single line object (memoized per line id).
 *
 * @param {Object} line – line object from the TCL API
 * @returns {{ prefix: string, number: string, groupKey: string, groupLabel: string,
 *             prefixColor: string, isTram: boolean }}
 */
const cache = new Map()
export function getLineGroupInfo(line) {
  const hit = cache.get(line.id)
  if (hit) return hit
  const info = computeInfo(line)
  cache.set(line.id, info)
  return info
}

function computeInfo(line) {
  const cmId  = line.commercialMode?.id ?? ''
  const sName = line.sName ?? ''
  const brand = '#' + (line.color || '5B2D8E')

  let res
  if (cmId === 'commercial_mode:tramway' || cmId === 'commercial_mode:tramnstadium') {
    // Each tram has its own brand color — use it for both halves
    res = { prefix: 'T', number: strip(sName, /^T/i), groupKey: 'tram', prefixColor: brand }
  } else if (cmId === 'commercial_mode:trambus') {
    res = { prefix: 'TB', number: strip(sName, /^TB/i), groupKey: 'trambus', prefixColor: '#C2620A' }
  } else if (cmId === 'commercial_mode:busc') {
    res = { prefix: 'C', number: strip(sName, /^C/i), groupKey: 'busc', prefixColor: TCL_RED }
  } else if (cmId === 'commercial_mode:busjd') {
    res = { prefix: 'JD', number: strip(sName, /^JD/i), groupKey: 'busjd', prefixColor: TCL_RED }
  } else if (cmId === 'commercial_mode:buspl') {
    res = { prefix: 'PL', number: strip(sName, /^PL/i), groupKey: 'special', prefixColor: '#1E2A4A' }
  } else if (cmId === 'commercial_mode:busnav') {
    res = { prefix: 'N', number: strip(sName, /^N/i), groupKey: 'special', prefixColor: TCL_RED }
  } else if (/^commercial_mode:busr/.test(cmId)) {
    res = { prefix: 'R', number: strip(sName, /^BR/i), groupKey: 'special', prefixColor: TCL_RED }
  } else {
    res = { prefix: 'BUS', number: sName, groupKey: 'bus', prefixColor: TCL_RED }
  }

  res.groupLabel = GROUP_LABELS[res.groupKey]
  res.isTram = TRAM_GROUPS.has(res.groupKey)
  return Object.freeze(res)
}

/** True for tram & trambus lines. */
export function isTramLine(line) {
  return !!line && getLineGroupInfo(line).isTram
}

/** Whether a line should appear in the picker at all. */
export function isPickableLine(line) {
  if (!line || HIDDEN_LINE_IDS.has(line.id)) return false
  return line.mode === 'BUS' || line.mode === 'TRAM'
}

/**
 * Groups an array of lines into ordered sections. Empty sections are omitted.
 *
 * @param {Array} items – lines, or objects wrapping a line
 * @param {(item: any) => Object} [getLine] – extracts the line from an item
 * @returns {Array<{ key: string, label: string, lines: Array }>}
 */
export function groupLines(items, getLine = (x) => x) {
  const buckets = Object.fromEntries(GROUP_ORDER.map((k) => [k, []]))
  for (const item of items) {
    const { groupKey } = getLineGroupInfo(getLine(item))
    ;(buckets[groupKey] ?? buckets.bus).push(item)
  }
  return GROUP_ORDER
    .filter((key) => buckets[key].length > 0)
    .map((key) => ({ key, label: GROUP_LABELS[key], lines: buckets[key] }))
}
