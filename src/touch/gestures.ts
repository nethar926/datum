import { clampView, xToFreq, type FreqView } from '../gram/axis'

/** Movement (CSS px) beyond which a press is a drag, not a tap or long-press. */
export const TAP_SLOP_PX = 10
export const LONG_PRESS_MS = 450
export const DOUBLE_TAP_MS = 300

/** Two-finger: distance change above this (px) prefers pinch; centroid move above this prefers pan. */
export const PINCH_DIST_THRESH_PX = 12
export const PAN_CENTROID_THRESH_PX = 10
/** Three-finger swipe-down must travel at least this many CSS px to lock. */
export const THREE_FINGER_SWIPE_PX = 48

export const exceedsSlop = (x0: number, y0: number, x1: number, y1: number, slop = TAP_SLOP_PX): boolean =>
  Math.hypot(x1 - x0, y1 - y0) > slop

/**
 * One-finger main cursor: the hairline sits EXACTLY under the contact (no touch offset).
 * Returns the CSS (x,y) used for Hz / time mapping — identity of the local pointer.
 */
export function fingerExactCursor(localX: number, localY: number): { x: number; y: number } {
  return { x: localX, y: localY }
}

export type TwoFingerKind = 'pinch' | 'pan' | 'undecided'

/**
 * Disambiguate pinch vs two-finger pan from the change in finger separation vs centroid travel.
 * Robust rule: large relative distance change → pinch; large centroid move with little scale → pan;
 * otherwise undecided (caller keeps prior classification or waits).
 */
export function classifyTwoFinger(
  a0: { x: number; y: number },
  b0: { x: number; y: number },
  a1: { x: number; y: number },
  b1: { x: number; y: number },
  opts?: { distThresh?: number; centroidThresh?: number },
): TwoFingerKind {
  const dThresh = opts?.distThresh ?? PINCH_DIST_THRESH_PX
  const cThresh = opts?.centroidThresh ?? PAN_CENTROID_THRESH_PX
  const d0 = Math.hypot(b0.x - a0.x, b0.y - a0.y)
  const d1 = Math.hypot(b1.x - a1.x, b1.y - a1.y)
  const dDist = Math.abs(d1 - d0)
  const c0x = (a0.x + b0.x) / 2, c0y = (a0.y + b0.y) / 2
  const c1x = (a1.x + b1.x) / 2, c1y = (a1.y + b1.y) / 2
  const dCent = Math.hypot(c1x - c0x, c1y - c0y)
  if (dDist < dThresh && dCent < cThresh) return 'undecided'
  // Prefer the dominant signal; tie → pinch when scale moved more than centroid.
  if (dDist >= dThresh && dDist >= dCent) return 'pinch'
  if (dCent >= cThresh) return 'pan'
  return 'undecided'
}

/**
 * Two-finger pinch + pan on a frequency axis. The frequency under the starting midpoint stays under the
 * current midpoint, and the span scales by the change in finger separation.
 * Fingers apart (d1 > d0) zooms bin width / bandwidth IN; together zooms OUT.
 */
export function pinchView(start: FreqView, a0: number, b0: number, a1: number, b1: number, width: number, fMax: number, minSpan = 10, fMin = 0): FreqView {
  const w = Math.max(1, width)
  const d0 = Math.max(8, Math.abs(b0 - a0)), d1 = Math.max(8, Math.abs(b1 - a1))
  const m0 = (a0 + b0) / 2, m1 = (a1 + b1) / 2
  const anchor = xToFreq(m0, start, w)
  const span = (start.hi - start.lo) * (d0 / d1)
  const lo = anchor - (m1 / w) * span
  return clampView({ lo, hi: lo + span }, fMax, minSpan, fMin)
}

/** One-axis pan by dx CSS px (content follows the finger). */
export function panView(start: FreqView, dx: number, width: number, fMax: number, minSpan = 10, fMin = 0): FreqView {
  const df = (dx / Math.max(1, width)) * (start.hi - start.lo)
  return clampView({ lo: start.lo - df, hi: start.hi - df }, fMax, minSpan, fMin)
}

/**
 * Two-finger horizontal pan through Hz (centroid Δx). Vertical component is ignored here —
 * time scroll-back is handled separately when paused.
 */
export function panFreqByCentroid(
  start: FreqView,
  dxCentroid: number,
  width: number,
  fMax: number,
  minSpan = 10,
  fMin = 0,
): FreqView {
  return panView(start, dxCentroid, width, fMax, minSpan, fMin)
}

/**
 * Map a two-finger vertical centroid move to Δscroll-back seconds.
 * Positive dy (fingers move down the screen) → look further back in time when newest-at-bottom.
 * `sign` is +1 for newest-at-bottom, −1 for newest-at-top.
 */
export function panScrollDeltaS(dyCentroid: number, height: number, visibleHistoryS: number, sign = 1): number {
  const h = Math.max(1, height)
  return sign * (dyCentroid / h) * visibleHistoryS
}

/** Locked axis of a two-finger pan, held until the fingers lift. */
export type PanAxis = 'frequency' | 'time'

/**
 * First decisive pan movement: the larger centroid component locks the axis.
 * A perfect diagonal (`|dx| === |dy|`) stays unlocked until one side wins.
 */
export function lockPanAxis(dx: number, dy: number): PanAxis | null {
  if (Math.abs(dx) > Math.abs(dy)) return 'frequency'
  if (Math.abs(dy) > Math.abs(dx)) return 'time'
  return null
}

/** True when three contacts move downward together by ≥ THREE_FINGER_SWIPE_PX (centroid). */
export function isThreeFingerSwipeDown(
  startYs: readonly number[],
  curYs: readonly number[],
  minPx = THREE_FINGER_SWIPE_PX,
): boolean {
  if (startYs.length < 3 || curYs.length < 3) return false
  const s0 = (startYs[0]! + startYs[1]! + startYs[2]!) / 3
  const s1 = (curYs[0]! + curYs[1]! + curYs[2]!) / 3
  return s1 - s0 >= minPx
}

export type Layout = 'wide' | 'phoneLandscape' | 'phonePortrait'
/** iPad (any orientation ≥ 700 px short side or wide landscape) keeps side-by-side; phones get their own layouts. */
export function classifyLayout(w: number, h: number): Layout {
  if (w >= h) return h < 500 ? 'phoneLandscape' : 'wide'
  return w < 700 ? 'phonePortrait' : 'wide'
}

/** Device-pixel cap for canvases: full retina up to 2×, never 3× (phones), to bound fill rate. */
export const MAX_DPR = 2
export const capDpr = (dpr: number | undefined): number => Math.min(MAX_DPR, Math.max(1, dpr || 1))
