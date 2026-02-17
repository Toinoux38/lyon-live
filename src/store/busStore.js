import { defineStore } from 'pinia'
import { fetchLines, fetchVehiclePositions, fetchLineDirections } from '@/api/tcl'

const POLL_INTERVAL_MS = 6000
const MAX_SELECTED = 3

export const useBusStore = defineStore('bus', {
  state: () => ({
    /** @type {Array} All available bus lines from the API */
    lines: [],

    /** @type {Set<string>} IDs of currently selected lines */
    selectedLineIds: new Set(),

    /** @type {Array} Currently tracked vehicles (merged outward + return) */
    vehicles: [],

    /** @type {Map<string, Object>} Cached line route/direction data */
    lineRoutes: new Map(),

    /** @type {boolean} */
    isLoadingLines: false,

    /** @type {boolean} */
    isPolling: false,

    /** @type {string|null} */
    error: null,

    /** @type {number|null} Internal polling timer */
    _pollTimer: null,
  }),

  getters: {
    /** Only BUS mode lines, sorted by short name. */
    busLines(state) {
      return state.lines
        .filter((l) => l.mode === 'BUS')
        .sort((a, b) => {
          const aName = a.sName || ''
          const bName = b.sName || ''
          return aName.localeCompare(bName, 'fr', { numeric: true })
        })
    },

    /** Array version of selectedLineIds for reactivity. */
    selectedIds(state) {
      return [...state.selectedLineIds]
    },

    /** Number of active lines. */
    activeLineCount(state) {
      return state.selectedLineIds.size
    },

    /** Maximum number of concurrent lines. */
    maxLines() {
      return MAX_SELECTED
    },

    /** True if no more lines can be selected. */
    maxReached(state) {
      return state.selectedLineIds.size >= MAX_SELECTED
    },

    /** Map of lineId -> line object for quick lookup. */
    lineMap(state) {
      const map = {}
      for (const line of state.lines) {
        map[line.id] = line
      }
      return map
    },

    /** Total vehicle count. */
    vehicleCount(state) {
      return state.vehicles.length
    },

    /** All cached route geometries for currently selected lines. */
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
    /**
     * Load all lines from the API.
     */
    async loadLines() {
      if (this.isLoadingLines) return
      this.isLoadingLines = true
      this.error = null

      try {
        this.lines = await fetchLines()
      } catch (err) {
        this.error = `Failed to load lines: ${err.message}`
        console.error('[busStore] loadLines error:', err)
      } finally {
        this.isLoadingLines = false
      }
    },

    /**
     * Toggle a line in/out of the selection.
     */
    toggleLine(lineId) {
      if (this.selectedLineIds.has(lineId)) {
        this.selectedLineIds.delete(lineId)
      } else {
        if (this.selectedLineIds.size >= MAX_SELECTED) return // enforce limit
        this.selectedLineIds.add(lineId)
        this.loadLineRoute(lineId)
      }
      this.fetchVehicles()
    },

    /**
     * Select lines up to the maximum allowed.
     */
    selectAll() {
      for (const line of this.busLines) {
        if (this.selectedLineIds.size >= MAX_SELECTED) break
        if (!this.selectedLineIds.has(line.id)) {
          this.selectedLineIds.add(line.id)
        }
      }
      this.fetchVehicles()
    },

    /**
     * Clear all selected lines and stop polling.
     */
    clearSelection() {
      this.selectedLineIds.clear()
      this.vehicles = []
      this.stopPolling()
    },

    /**
     * Fetch and cache line route/directions data.
     */
    async loadLineRoute(lineId) {
      if (this.lineRoutes.has(lineId)) return
      try {
        const data = await fetchLineDirections(lineId)
        this.lineRoutes.set(lineId, data)
      } catch (err) {
        console.warn('[busStore] Failed to load route for', lineId, err)
      }
    },

    /**
     * Fetch vehicle positions for all selected lines.
     */
    async fetchVehicles() {
      const ids = [...this.selectedLineIds]
      if (!ids.length) {
        this.vehicles = []
        return
      }

      try {
        this.vehicles = await fetchVehiclePositions(ids)
        this.error = null
      } catch (err) {
        this.error = `Failed to fetch vehicles: ${err.message}`
        console.error('[busStore] fetchVehicles error:', err)
      }
    },

    /**
     * Start polling vehicle positions.
     */
    startPolling() {
      if (this._pollTimer) return
      this.isPolling = true
      this.fetchVehicles()

      this._pollTimer = setInterval(() => {
        if (this.selectedLineIds.size > 0) {
          this.fetchVehicles()
        }
      }, POLL_INTERVAL_MS)
    },

    /**
     * Stop polling.
     */
    stopPolling() {
      if (this._pollTimer) {
        clearInterval(this._pollTimer)
        this._pollTimer = null
      }
      this.isPolling = false
    },
  },
})
