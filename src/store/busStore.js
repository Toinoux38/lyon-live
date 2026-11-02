import { defineStore } from 'pinia'
import { fetchLines, fetchVehiclePositions, fetchLineDirections } from '@/api/tcl'
import { isPickableLine } from '@/utils/lineGroup'

const POLL_INTERVAL_MS = 6000
const MAX_SELECTED = 3
const MAX_RECENT = 6
const STORAGE_KEY = 'tcl_recent_lines'

// Non-reactive internals (kept out of Pinia state on purpose)
let pollTimer = null
let fetchSeq = 0
const routeRequests = new Map() // lineId -> in-flight Promise

function onVisibilityChange() {
  const store = useBusStore()
  // Catch up immediately when the user comes back to the tab
  if (!document.hidden && store.isPolling) store.fetchVehicles()
}

export const useBusStore = defineStore('bus', {
  state: () => ({
    /** @type {Array} All lines from the API (every mode) */
    lines: [],

    /** @type {Set<string>} IDs of currently selected lines (insertion-ordered) */
    selectedLineIds: new Set(),

    /** @type {Object<string, number>} lineId -> color slot index (stable while selected) */
    lineSlots: {},

    /** @type {Array<string>} Recently selected line IDs (persisted) */
    recentLineIds: [],

    /** @type {Array} Raw vehicles for the selected lines (both directions) */
    vehicles: [],

    /** @type {Map<string, Object>} Cached line route/direction data */
    lineRoutes: new Map(),

    /** @type {Object} Per-line direction filter: lineId -> 'both'|'outward'|'return' */
    lineDirectionMap: {},

    /** Bumped when the user picks a line, so the map can frame it. */
    focusRequest: { lineId: null, seq: 0 },

    /** @type {number|null} Timestamp of the last successful vehicle fetch */
    lastUpdated: null,

    isLoadingLines: false,
    isPolling: false,
    /** @type {string|null} */
    error: null,
  }),

  getters: {
    /** Bus + tram lines users can pick, sorted by short name. */
    transitLines(state) {
      return state.lines
        .filter(isPickableLine)
        .sort((a, b) => (a.sName || '').localeCompare(b.sName || '', 'fr', { numeric: true }))
    },

    /** Array version of selectedLineIds (selection order). */
    selectedIds(state) {
      return [...state.selectedLineIds]
    },

    activeLineCount(state) {
      return state.selectedLineIds.size
    },

    maxLines() {
      return MAX_SELECTED
    },

    maxReached(state) {
      return state.selectedLineIds.size >= MAX_SELECTED
    },

    /** lineId -> line object. */
    lineMap(state) {
      const map = {}
      for (const line of state.lines) map[line.id] = line
      return map
    },

    /**
     * Vehicles that should be on the map: belong to a still-selected line and
     * match that line's direction filter.
     */
    visibleVehicles(state) {
      return state.vehicles.filter((v) => {
        if (!state.selectedLineIds.has(v.lineId)) return false
        const dir = state.lineDirectionMap[v.lineId] || 'both'
        return dir === 'both' || v.direction === dir
      })
    },

    vehicleCount() {
      return this.visibleVehicles.length
    },

    tramCount() {
      return this.visibleVehicles.filter((v) => v.mode === 'TRAM').length
    },

    busCount() {
      return this.vehicleCount - this.tramCount
    },

    /** Cached route geometries for currently selected lines. */
    activeRoutes(state) {
      const routes = []
      for (const id of state.selectedLineIds) {
        const route = state.lineRoutes.get(id)
        if (route) routes.push({ lineId: id, data: route })
      }
      return routes
    },
  },

  actions: {
    loadRecentLines() {
      try {
        const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
        this.recentLineIds = Array.isArray(stored) ? stored.filter((x) => typeof x === 'string') : []
      } catch (err) {
        console.warn('[busStore] Failed to load recent lines:', err)
        this.recentLineIds = []
      }
    },

    saveRecentLines() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.recentLineIds))
      } catch (err) {
        console.warn('[busStore] Failed to save recent lines:', err)
      }
    },

    addToRecent(lineId) {
      this.recentLineIds = [lineId, ...this.recentLineIds.filter((id) => id !== lineId)].slice(0, MAX_RECENT)
      this.saveRecentLines()
    },

    async loadLines() {
      if (this.isLoadingLines) return
      this.isLoadingLines = true
      this.error = null
      this.loadRecentLines()

      try {
        this.lines = await fetchLines()
      } catch (err) {
        this.error = `Couldn't load lines: ${err.message}`
        console.error('[busStore] loadLines error:', err)
      } finally {
        this.isLoadingLines = false
      }
    },

    /**
     * @param {string} lineId
     * @param {'both'|'outward'|'return'} direction
     */
    setLineDirection(lineId, direction) {
      this.lineDirectionMap = { ...this.lineDirectionMap, [lineId]: direction }
    },

    toggleLine(lineId) {
      if (this.selectedLineIds.has(lineId)) {
        this.selectedLineIds.delete(lineId)
        const { [lineId]: _d, ...dirs } = this.lineDirectionMap
        this.lineDirectionMap = dirs
        const { [lineId]: _s, ...slots } = this.lineSlots
        this.lineSlots = slots
        // Drop that line's vehicles right away instead of waiting for the next poll
        this.vehicles = this.vehicles.filter((v) => v.lineId !== lineId)
      } else {
        if (this.selectedLineIds.size >= MAX_SELECTED) return
        // Take the lowest free color slot so other lines keep their colors
        const used = new Set(Object.values(this.lineSlots))
        let slot = 0
        while (used.has(slot)) slot++
        this.lineSlots = { ...this.lineSlots, [lineId]: slot }
        this.selectedLineIds.add(lineId)
        this.loadLineRoute(lineId)
        this.addToRecent(lineId)
        this.focusRequest = { lineId, seq: this.focusRequest.seq + 1 }
      }
      this.fetchVehicles()
    },

    clearSelection() {
      this.selectedLineIds.clear()
      this.lineSlots = {}
      this.lineDirectionMap = {}
      this.vehicles = []
      this.error = null
      this.stopPolling()
    },

    /** Fetch and cache a line's route; concurrent calls share one request. */
    loadLineRoute(lineId) {
      if (this.lineRoutes.has(lineId)) return Promise.resolve()
      if (routeRequests.has(lineId)) return routeRequests.get(lineId)

      const req = fetchLineDirections(lineId)
        .then((data) => { this.lineRoutes.set(lineId, data) })
        .catch((err) => { console.warn('[busStore] Failed to load route for', lineId, err) })
        .finally(() => { routeRequests.delete(lineId) })
      routeRequests.set(lineId, req)
      return req
    },

    /** Fetch vehicle positions for all selected lines. Out-of-order responses are dropped. */
    async fetchVehicles() {
      const ids = [...this.selectedLineIds]
      const seq = ++fetchSeq
      if (!ids.length) {
        this.vehicles = []
        return
      }

      try {
        const vehicles = await fetchVehiclePositions(ids)
        if (seq !== fetchSeq) return // a newer request superseded this one
        this.vehicles = vehicles.filter((v) => this.selectedLineIds.has(v.lineId))
        this.lastUpdated = Date.now()
        this.error = null
      } catch (err) {
        if (seq !== fetchSeq) return
        this.error = `Live data unavailable (${err.message})`
        console.error('[busStore] fetchVehicles error:', err)
      }
    },

    /**
     * Start polling vehicle positions. Does NOT fetch immediately — toggleLine
     * already did. Skips ticks while the tab is hidden to save battery/data.
     */
    startPolling() {
      if (pollTimer) return
      this.isPolling = true
      pollTimer = setInterval(() => {
        if (this.selectedLineIds.size > 0 && !document.hidden) this.fetchVehicles()
      }, POLL_INTERVAL_MS)
      document.addEventListener('visibilitychange', onVisibilityChange)
    },

    stopPolling() {
      if (pollTimer) {
        clearInterval(pollTimer)
        pollTimer = null
      }
      document.removeEventListener('visibilitychange', onVisibilityChange)
      this.isPolling = false
    },
  },
})
