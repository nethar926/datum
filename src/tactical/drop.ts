import { planPattern, type PatternKind } from '@acoustics'

/**
 * Manual sonobuoy drop geometry. The engine's planPattern (acoustics/src/patterns.ts) owns each pattern's shape,
 * buoy count rules, receiver type and RF channel suggestions; this module only maps a tap/drag gesture onto it and
 * applies a similarity transform (translate + uniform scale) so the operator's drag sets the extent. planPattern
 * sizes patterns from a detection-range budget (≈ 9.8 km at its training defaults, spacing clamped to ≥ 0.5 R and the
 * ring radius fixed at R), which is far larger than the 18 km tactical plot, so the extent is applied here.
 */
export type DropPattern = 'line' | 'circle' | 'field' | 'wedge' | 'single'
export const DROP_PATTERNS: readonly DropPattern[] = ['line', 'circle', 'field', 'wedge', 'single']
export const PATTERN_KIND: Record<DropPattern, PatternKind> = { line: 'barrier', circle: 'ring', field: 'grid', wedge: 'wedge', single: 'single' }
export const PATTERN_LABEL: Record<DropPattern, string> = { line: 'Line', circle: 'Circle', field: 'Field', wedge: 'Wedge', single: 'Single' }
export const DEFAULT_COUNT: Record<DropPattern, number> = { line: 5, circle: 6, field: 9, wedge: 5, single: 1 }
export const COUNT_RANGE: Record<DropPattern, readonly [number, number]> = { line: [2, 12], circle: [5, 12], field: [4, 16], wedge: [3, 11], single: [1, 1] }
/** Tap (no drag) extent: line length, circle radius, field centre→corner, wedge apex→tips depth (m). */
export const DEFAULT_EXTENT_M: Record<DropPattern, number> = { line: 8000, circle: 3000, field: 2800, wedge: 4000, single: 0 }
/** Tap orientation (deg true): line runs east–west, wedge opens north, ring starts north, field corner NE. */
export const DEFAULT_BEARING: Record<DropPattern, number> = { line: 90, circle: 0, field: 45, wedge: 0, single: 0 }
export const EXTENT_RANGE_M: readonly [number, number] = [1000, 16000]
/** Snap steps: position to a 100 m grid, orientation to 5°, extent to 100 m. */
export const SNAP_POS_M = 100, SNAP_DEG = 5, SNAP_EXTENT_M = 100
/** Patterns whose orientation and extent follow a drag (single and a tapped pattern use the defaults). */
export const DRAGGABLE: Record<DropPattern, boolean> = { line: true, circle: true, field: true, wedge: true, single: false }

export interface Pt { x: number; y: number }
/** Where and how a pattern is laid: centre (line midpoint, ring/field centre, wedge apex, single point). */
export interface Placement { pattern: DropPattern; center: Pt; bearingDeg: number; extentM: number; dragged: boolean
  /** Drag start → end (snapped), for the gesture guide on the plot. */
  from?: Pt; to?: Pt }
export type DropKind = 'omni' | 'difar' | 'bt'
export interface DropPlan { pattern: DropPattern; n: number
  /** x0,y0,x1,y1,… metres (x east, y north). */
  xy: Float64Array; kinds: DropKind[]; channels: number[]
  center: Pt; bearingDeg: number; extentM: number; spacingM: number; placement: Placement }

export const norm360 = (d: number): number => ((d % 360) + 360) % 360
export const snapDeg = (d: number, step = SNAP_DEG): number => norm360(Math.round(norm360(d) / step) * step)
export const snapM = (m: number, step = SNAP_EXTENT_M): number => Math.round(m / step) * step
export const snapPt = (p: Pt, step = SNAP_POS_M): Pt => ({ x: snapM(p.x, step), y: snapM(p.y, step) })
export const clampExtent = (m: number): number => Math.min(EXTENT_RANGE_M[1], Math.max(EXTENT_RANGE_M[0], m))
export const clampCount = (p: DropPattern, n: number): number => Math.min(COUNT_RANGE[p][1], Math.max(COUNT_RANGE[p][0], Math.round(n)))
/** Bearing (deg true, clockwise from north) of b seen from a. */
export const bearingDeg = (a: Pt, b: Pt): number => norm360((Math.atan2(b.x - a.x, b.y - a.y) * 180) / Math.PI)

/**
 * Gesture → placement. Tap: pattern centred on the tap with the default size and orientation. Drag:
 * line = drawn end to end; circle = centre then radius (first buoy under the finger); field = centre then a
 * corner; wedge = apex then the opening direction and depth; single = follows the finger.
 */
export function gesturePlacement(pattern: DropPattern, start: Pt, end: Pt | null): Placement {
  const s = snapPt(start)
  if (!end || !DRAGGABLE[pattern]) {
    const c = pattern === 'single' && end ? snapPt(end) : s
    return { pattern, center: c, bearingDeg: DEFAULT_BEARING[pattern], extentM: DEFAULT_EXTENT_M[pattern], dragged: false }
  }
  const brg = snapDeg(bearingDeg(s, end)), ext = clampExtent(snapM(Math.hypot(end.x - s.x, end.y - s.y)))
  const t = (brg * Math.PI) / 180, to = { x: s.x + ext * Math.sin(t), y: s.y + ext * Math.cos(t) }
  const center = pattern === 'line' ? { x: (s.x + to.x) / 2, y: (s.y + to.y) / 2 } : s
  return { pattern, center, bearingDeg: brg, extentM: ext, dragged: true, from: s, to }
}

const sinD = (d: number) => Math.sin((d * Math.PI) / 180), cosD = (d: number) => Math.cos((d * Math.PI) / 180)

/** Placement + count → buoy positions via the engine planner (orientation/extent applied as a similarity transform). */
export function planDrop(pl: Placement, count = DEFAULT_COUNT[pl.pattern], seed = 0, buoyKind?: DropKind): DropPlan {
  const pattern = pl.pattern, kind = PATTERN_KIND[pattern], n0 = clampCount(pattern, count)
  // Planner axis: barrier lies across its axis; grid corner sits 45° clockwise of it; ring/wedge use it as is.
  const axisDeg = pattern === 'line' ? norm360(pl.bearingDeg - 90) : pattern === 'field' ? norm360(pl.bearingDeg - 45) : pl.bearingDeg
  const plan = planPattern({ kind, center: { x: 0, y: 0 }, axisDeg, count: n0, seed })
  const pts = plan.points, n = pts.length
  // Anchor (maps to pl.center): the wedge apex, else the planner's centre.
  const ax = pattern === 'wedge' ? pts[0].x : 0, ay = pattern === 'wedge' ? pts[0].y : 0
  let ref = 0
  if (pattern === 'line') ref = (n - 1) * plan.spacingM
  else if (pattern === 'circle') ref = plan.detectionRangeM
  else if (pattern === 'field') { for (const p of pts) ref = Math.max(ref, Math.hypot(p.x, p.y)) }
  else if (pattern === 'wedge') { const ux = sinD(pl.bearingDeg), uy = cosD(pl.bearingDeg); for (const p of pts) ref = Math.max(ref, (p.x - ax) * ux + (p.y - ay) * uy) }
  const k = ref > 0 ? pl.extentM / ref : 0
  const xy = new Float64Array(2 * n)
  for (let i = 0; i < n; i++) { xy[2 * i] = pl.center.x + (pts[i].x - ax) * k; xy[2 * i + 1] = pl.center.y + (pts[i].y - ay) * k }
  const spacingM = pattern === 'circle' ? 2 * pl.extentM * Math.sin(Math.PI / n) : pattern === 'single' ? 0 : plan.spacingM * k
  return { pattern, n, xy, kinds: plan.types.map((t) => buoyKind ?? (t === 'passive-omni' ? 'omni' : 'difar')), channels: plan.channels.slice(),
    center: { ...pl.center }, bearingDeg: pl.bearingDeg, extentM: pattern === 'single' ? 0 : pl.extentM, spacingM, placement: pl }
}

const km = (m: number) => `${(m / 1000).toFixed(1)} km`
const deg3 = (d: number) => String(Math.round(norm360(d)) % 360).padStart(3, '0')
/** One-line readout for the confirm bar and the plot label. */
export function planReadout(p: DropPlan): string {
  const kinds = p.kinds[0] === 'omni' ? 'OMNI' : p.kinds[0] === 'bt' ? 'BT' : 'DIFAR', head = `${PATTERN_LABEL[p.pattern].toUpperCase()} · ${p.n} ${kinds}`
  switch (p.pattern) {
    case 'line': return `${head} · ${km(p.extentM)} · ${deg3(p.bearingDeg)}°`
    case 'circle': return `${head} · r ${km(p.extentM)}`
    case 'field': return `${head} · ${km(p.spacingM)} grid · ${deg3(p.bearingDeg)}°`
    case 'wedge': return `${head} · ${km(p.extentM)} · opens ${deg3(p.bearingDeg)}°`
    case 'single': return `SINGLE · 1 ${kinds} · ${(p.center.x / 1000).toFixed(1)}E ${(p.center.y / 1000).toFixed(1)}N`
  }
}

/**
 * AUTO field mode lay, via the planner's 'auto' kind: a finite threat axis gives a barrier across it, otherwise a
 * ring. With a fix, the barrier is centred on it across the axis from the field centroid; without one, a ring of
 * AUTO_RING_M round the centroid.
 */
export const AUTO_RING_M = 5000, AUTO_LINE_M = 8000
export function autoPlacement(fix: Pt | null, field: readonly Pt[]): Placement {
  let cx = 0, cy = 0
  for (const b of field) { cx += b.x; cy += b.y }
  const c = field.length ? { x: cx / field.length, y: cy / field.length } : { x: 0, y: 0 }
  const axis = fix && Math.hypot(fix.x - c.x, fix.y - c.y) >= 1 ? bearingDeg(c, fix) : NaN
  const resolved = planPattern({ kind: 'auto', center: fix ?? c, axisDeg: axis }).kind
  if (resolved === 'barrier' && fix) return { pattern: 'line', center: snapPt(fix), bearingDeg: snapDeg(axis + 90), extentM: AUTO_LINE_M, dragged: false }
  return { pattern: 'circle', center: snapPt(c), bearingDeg: 0, extentM: AUTO_RING_M, dragged: false }
}
