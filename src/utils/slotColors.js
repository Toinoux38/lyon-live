/**
 * Map colors for selected lines. Each selected line gets a stable "slot":
 * a dark shade for the outward direction and a light shade for the return.
 *
 * We deliberately don't draw lines in their brand colors: many TCL lines share
 * the same hue (e.g. T1 and C1 are both #004F9F), so three hand-picked,
 * high-contrast slots keep the map readable.
 */
export const SLOT_COLORS = [
  { outward: '#DC2626', return: '#F87171' }, // red
  { outward: '#1E3A5F', return: '#60A5FA' }, // navy / sky
  { outward: '#374151', return: '#9CA3AF' }, // graphite
]

export function slotColors(slotIndex) {
  return SLOT_COLORS[slotIndex] ?? SLOT_COLORS[0]
}
