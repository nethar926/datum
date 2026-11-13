/**
 * Deterministic callsign / tag placement around plot glyphs.
 * Shared with native `PlotLabelLayout` (DatumAppCore).
 *
 * Eight compass offsets are tried in a fixed order. The first that does not
 * overlap another label or a symbol wins. If none fit, the radius grows and a
 * thin leader is requested. Previous slots are preferred (hysteresis) so labels
 * do not jitter as contacts move. Symbols stay at their true positions; only
 * labels move. O(n²); callers reuse `PlotLabelScratch`.
 */

export const PLOT_LABEL_GAP = 10
export const PLOT_LABEL_ENTER_GAP = 2
export const PLOT_LABEL_HYSTERESIS = 1
export const PLOT_LABEL_EXTRA_RINGS = 6
export const PLOT_LABEL_MONO_ADVANCE = 0.62

/** E, NE, N, NW, W, SW, S, SE. */
export const PLOT_LABEL_COMPASS: readonly (readonly [number, number])[] = [
  [1, 0], [1, -1], [0, -1], [-1, -1],
  [-1, 0], [-1, 1], [0, 1], [1, 1],
]

export interface PlotLabelRect { x: number; y: number; w: number; h: number }
export interface PlotLabelItem { id: string; ax: number; ay: number; width: number; height: number }
export interface PlotLabelPlacement { id: string; x: number; y: number; leader: boolean; slot: number }

export function plotLabelSize(text: string, fontSize: number): { w: number; h: number } {
  return { w: Math.max(4, text.length * fontSize * PLOT_LABEL_MONO_ADVANCE + 2), h: fontSize + 3 }
}

export function plotLabelTopLeft(item: PlotLabelItem, slot: number, ring: number): { x: number; y: number } {
  const n = PLOT_LABEL_COMPASS.length
  const i = ((slot % n) + n) % n
  const r = PLOT_LABEL_GAP * (1 + Math.max(0, ring))
  const [dx, dy] = PLOT_LABEL_COMPASS[i]!
  let x: number, y: number
  if (dx === 0) x = item.ax - item.width / 2
  else if (dx > 0) x = item.ax + r
  else x = item.ax - r - item.width
  if (dy === 0) y = item.ay - item.height / 2
  else if (dy > 0) y = item.ay + r
  else y = item.ay - r - item.height
  return { x, y }
}

export function clampPlotLabel(
  x: number, y: number, w: number, h: number,
  canvasX: number, canvasY: number, canvasW: number, canvasH: number, margin: number,
): { x: number; y: number } {
  const minX = canvasX + margin, minY = canvasY + margin
  const maxX = canvasX + canvasW - w - margin
  const maxY = canvasY + canvasH - h - margin
  return { x: Math.min(Math.max(minX, x), Math.max(minX, maxX)), y: Math.min(Math.max(minY, y), Math.max(minY, maxY)) }
}

export function plotLabelOverlaps(a: PlotLabelRect, b: PlotLabelRect, gap: number): boolean {
  return !(a.x + a.w + gap <= b.x || b.x + b.w + gap <= a.x || a.y + a.h + gap <= b.y || b.y + b.h + gap <= a.y)
}

export function plotLabelLeaderEnd(
  p: PlotLabelPlacement, anchorX: number, anchorY: number, width: number, height: number,
): { x: number; y: number } {
  return {
    x: Math.min(Math.max(anchorX, p.x), p.x + width),
    y: Math.min(Math.max(anchorY, p.y), p.y + height),
  }
}

export interface PlotLabelScratch {
  previous: Map<string, PlotLabelPlacement>
  obstacles: PlotLabelRect[]
  placed: PlotLabelPlacement[]
}

export function makePlotLabelScratch(): PlotLabelScratch {
  return { previous: new Map(), obstacles: [], placed: [] }
}

function hits(rect: PlotLabelRect, obstacles: PlotLabelRect[], gap: number): boolean {
  for (let i = 0; i < obstacles.length; i++) if (plotLabelOverlaps(rect, obstacles[i]!, gap)) return true
  return false
}

function placeOne(
  item: PlotLabelItem,
  canvasX: number, canvasY: number, canvasW: number, canvasH: number,
  margin: number, scratch: PlotLabelScratch,
): PlotLabelPlacement {
  const prev = scratch.previous.get(item.id)
  if (prev) {
    const n = PLOT_LABEL_COMPASS.length
    const ring = prev.slot >= n ? Math.floor(prev.slot / n) : 0
    const slot = prev.slot % n
    const raw = plotLabelTopLeft(item, slot, ring)
    const c = clampPlotLabel(raw.x, raw.y, item.width, item.height, canvasX, canvasY, canvasW, canvasH, margin)
    const rect = { x: c.x, y: c.y, w: item.width, h: item.height }
    if (!hits(rect, scratch.obstacles, -PLOT_LABEL_HYSTERESIS)) {
      return { id: item.id, x: c.x, y: c.y, leader: ring > 0, slot: ring * n + slot }
    }
  }
  const rings = 1 + PLOT_LABEL_EXTRA_RINGS
  const n = PLOT_LABEL_COMPASS.length
  for (let ring = 0; ring < rings; ring++) {
    for (let slot = 0; slot < n; slot++) {
      const raw = plotLabelTopLeft(item, slot, ring)
      const c = clampPlotLabel(raw.x, raw.y, item.width, item.height, canvasX, canvasY, canvasW, canvasH, margin)
      const rect = { x: c.x, y: c.y, w: item.width, h: item.height }
      if (!hits(rect, scratch.obstacles, PLOT_LABEL_ENTER_GAP)) {
        return { id: item.id, x: c.x, y: c.y, leader: ring > 0, slot: ring * n + slot }
      }
    }
  }
  const raw = plotLabelTopLeft(item, 2, PLOT_LABEL_EXTRA_RINGS)
  const c = clampPlotLabel(raw.x, raw.y, item.width, item.height, canvasX, canvasY, canvasW, canvasH, margin)
  return { id: item.id, x: c.x, y: c.y, leader: true, slot: PLOT_LABEL_EXTRA_RINGS * n + 2 }
}

export function placePlotLabels(
  items: readonly PlotLabelItem[],
  symbols: readonly PlotLabelRect[],
  chrome: readonly PlotLabelRect[],
  canvasX: number, canvasY: number, canvasW: number, canvasH: number,
  scratch: PlotLabelScratch,
  margin = 2,
): void {
  scratch.obstacles.length = 0
  scratch.placed.length = 0
  for (const r of chrome) scratch.obstacles.push(r)
  for (const r of symbols) scratch.obstacles.push(r)
  const seen = new Set<string>()
  for (const item of items) {
    seen.add(item.id)
    const p = placeOne(item, canvasX, canvasY, canvasW, canvasH, margin, scratch)
    scratch.placed.push(p)
    scratch.obstacles.push({ x: p.x, y: p.y, w: item.width, h: item.height })
    scratch.previous.set(item.id, p)
  }
  if (scratch.previous.size > seen.size) {
    for (const id of [...scratch.previous.keys()]) if (!seen.has(id)) scratch.previous.delete(id)
  }
}
