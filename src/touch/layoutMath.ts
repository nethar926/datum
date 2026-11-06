/**
 * LAY1 pure layout math: phone-portrait plot detents and dual-screen (Duo) hinge splits.
 * Kept allocation-free for the hot path except returning small plain objects from the API helpers.
 */

/** Phone-portrait plot sheet detents (gram pushed up as the plot slides in). */
export type PlotDetent = 'gram' | 'half' | 'plot'

/** Progress of the plot sheet: 0 = gram only, 0.5 = half, 1 = plot only. */
export const DETENT_PROGRESS: Record<PlotDetent, number> = {
  gram: 0,
  half: 0.5,
  plot: 1,
}

export const DETENTS: readonly PlotDetent[] = ['gram', 'half', 'plot']

/** Spring duration for detent settles (Apple polish bar: 150–200 ms). */
export const DETENT_SPRING_MS = 180

/** Flick velocity (progress / ms) that jumps a detent even without crossing the midpoint. */
export const DETENT_FLICK_V = 0.0025

/**
 * Snap a free-drag progress (and optional release velocity) onto the nearest detent.
 * Velocity is Δprogress / Δms; a flick toward a neighbour jumps even from short of the midpoint.
 */
export function snapDetent(progress: number, velocity = 0): PlotDetent {
  const p = clamp01(progress)
  if (velocity <= -DETENT_FLICK_V) {
    // Flicking down (closing the plot): prefer the lower detent.
    if (p > 0.75) return 'half'
    if (p > 0.25) return 'gram'
    return 'gram'
  }
  if (velocity >= DETENT_FLICK_V) {
    // Flicking up (opening the plot): prefer the higher detent.
    if (p < 0.25) return 'half'
    if (p < 0.75) return 'plot'
    return 'plot'
  }
  if (p < 0.25) return 'gram'
  if (p < 0.75) return 'half'
  return 'plot'
}

/** Cycle detents on a tap of the grabber (gram → half → plot → gram). */
export function nextDetent(cur: PlotDetent): PlotDetent {
  return DETENTS[(DETENTS.indexOf(cur) + 1) % DETENTS.length]!
}

/** Previous detent (plot → half → gram → plot). */
export function prevDetent(cur: PlotDetent): PlotDetent {
  const i = DETENTS.indexOf(cur)
  return DETENTS[(i - 1 + DETENTS.length) % DETENTS.length]!
}

export function detentProgress(d: PlotDetent): number {
  return DETENT_PROGRESS[d]
}

/**
 * Map a pointer drag on the grabber into sheet progress.
 * `startProgress` is the detent (or live) progress when the drag began; `dy` is finger movement in CSS px
 * (positive = finger down = closing the plot); `travelPx` is the full-sheet travel (workspace height).
 */
export function progressFromDrag(startProgress: number, dy: number, travelPx: number): number {
  const t = Math.max(1, travelPx)
  // Finger down closes the plot (progress decreases).
  return clamp01(startProgress - dy / t)
}

export type SegmentRect = { x: number; y: number; width: number; height: number }

export type ViewportSize = { width: number; height: number }

export type SegmentSplit =
  | { mode: 'normal' }
  | {
      mode: 'hinge'
      axis: 'x' | 'y'
      /** First screen (gram). */
      a: SegmentRect
      /** Second screen (plot). */
      b: SegmentRect
      /** Fold / hinge gap between the two screens (may be zero-width). */
      fold: SegmentRect
    }

/** Slop (CSS px) when comparing segment edges to the viewport. */
const SEG_EPS = 1

/** True when a rect has finite, positive geometry. */
export function segmentRectOk(r: SegmentRect): boolean {
  return Number.isFinite(r.x) && Number.isFinite(r.y)
    && Number.isFinite(r.width) && Number.isFinite(r.height)
    && r.width > 0 && r.height > 0
}

/**
 * Reject hinge geometry that would paint past the viewport or that looks internally inconsistent
 * (overlap, negative gap, out of bounds, span wider/taller than the window).
 */
export function segmentsFitViewport(
  a: SegmentRect,
  b: SegmentRect,
  axis: 'x' | 'y',
  viewport?: ViewportSize | null,
): boolean {
  if (!segmentRectOk(a) || !segmentRectOk(b)) return false
  if (axis === 'x') {
    // Same row, A then B, no overlap.
    if (Math.abs(a.y - b.y) > SEG_EPS) return false
    if (a.x + a.width > b.x + SEG_EPS) return false
    if (viewport && Number.isFinite(viewport.width) && viewport.width > 0) {
      const left = Math.min(a.x, b.x)
      const right = Math.max(a.x + a.width, b.x + b.width)
      if (left < -SEG_EPS) return false
      if (right > viewport.width + SEG_EPS) return false
      if (right - left > viewport.width + SEG_EPS) return false
    }
    return true
  }
  // Vertical hinge: same column, A then B.
  if (Math.abs(a.x - b.x) > SEG_EPS) return false
  if (a.y + a.height > b.y + SEG_EPS) return false
  if (viewport && Number.isFinite(viewport.height) && viewport.height > 0) {
    const top = Math.min(a.y, b.y)
    const bottom = Math.max(a.y + a.height, b.y + b.height)
    if (top < -SEG_EPS) return false
    if (bottom > viewport.height + SEG_EPS) return false
    if (bottom - top > viewport.height + SEG_EPS) return false
  }
  return true
}

/**
 * Dual-screen hinge layout from `window.viewport.segments` (or a stub).
 * Two side-by-side segments → horizontal hinge (gram left, plot right).
 * Two stacked segments → vertical hinge (gram top, plot bottom).
 * Anything else — or geometry that overflows / is inconsistent with `viewport` — falls back to normal.
 */
export function computeSegmentSplit(
  segments: readonly SegmentRect[] | null | undefined,
  viewport?: ViewportSize | null,
): SegmentSplit {
  if (!segments || segments.length < 2) return { mode: 'normal' }
  const sorted = segments.slice().sort((p, q) => (p.y - q.y) || (p.x - q.x))
  const a = sorted[0]!, b = sorted[1]!
  if (!segmentRectOk(a) || !segmentRectOk(b)) return { mode: 'normal' }

  // Horizontal hinge: same row, distinct columns.
  if (Math.abs(a.y - b.y) < 2 && a.x + a.width <= b.x + 2) {
    if (!segmentsFitViewport(a, b, 'x', viewport)) return { mode: 'normal' }
    const foldX = a.x + a.width
    const foldW = Math.max(0, b.x - foldX)
    return {
      mode: 'hinge',
      axis: 'x',
      a: { x: a.x, y: a.y, width: a.width, height: a.height },
      b: { x: b.x, y: b.y, width: b.width, height: b.height },
      fold: { x: foldX, y: Math.min(a.y, b.y), width: foldW, height: Math.max(a.height, b.height) },
    }
  }
  // Vertical hinge: same column, distinct rows.
  if (Math.abs(a.x - b.x) < 2 && a.y + a.height <= b.y + 2) {
    if (!segmentsFitViewport(a, b, 'y', viewport)) return { mode: 'normal' }
    const foldY = a.y + a.height
    const foldH = Math.max(0, b.y - foldY)
    return {
      mode: 'hinge',
      axis: 'y',
      a: { x: a.x, y: a.y, width: a.width, height: a.height },
      b: { x: b.x, y: b.y, width: b.width, height: b.height },
      fold: { x: Math.min(a.x, b.x), y: foldY, width: Math.max(a.width, b.width), height: foldH },
    }
  }
  return { mode: 'normal' }
}

/** True when a hinge split has a usable fold gap (content must not paint into it). */
export function hasFoldGap(split: SegmentSplit): boolean {
  if (split.mode !== 'hinge') return false
  return split.axis === 'x' ? split.fold.width > 0 : split.fold.height > 0
}

/**
 * CSS custom properties for a hinge layout, so the workspace can place gram / fold / plot
 * without React measuring every frame. Values are in CSS px relative to the visual viewport origin.
 */
export function segmentCssVars(split: SegmentSplit): Record<string, string> | null {
  if (split.mode !== 'hinge') return null
  const { a, b, fold, axis } = split
  return {
    '--seg-a-x': `${a.x}px`,
    '--seg-a-y': `${a.y}px`,
    '--seg-a-w': `${a.width}px`,
    '--seg-a-h': `${a.height}px`,
    '--seg-b-x': `${b.x}px`,
    '--seg-b-y': `${b.y}px`,
    '--seg-b-w': `${b.width}px`,
    '--seg-b-h': `${b.height}px`,
    '--seg-fold-x': `${fold.x}px`,
    '--seg-fold-y': `${fold.y}px`,
    '--seg-fold-w': `${fold.width}px`,
    '--seg-fold-h': `${fold.height}px`,
    '--seg-axis': axis,
  }
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.min(1, Math.max(0, n))
}
