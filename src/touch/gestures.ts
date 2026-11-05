import { clampView, xToFreq, type FreqView } from '../gram/axis'

/** Movement (CSS px) beyond which a press is a drag, not a tap or long-press. */
export const TAP_SLOP_PX = 10
export const LONG_PRESS_MS = 450
export const DOUBLE_TAP_MS = 300

export const exceedsSlop = (x0: number, y0: number, x1: number, y1: number, slop = TAP_SLOP_PX): boolean =>
  Math.hypot(x1 - x0, y1 - y0) > slop

/**
 * Two-finger pinch + pan on a frequency axis. The frequency under the starting midpoint stays under the
 * current midpoint, and the span scales by the change in finger separation.
 */
export function pinchView(start: FreqView, a0: number, b0: number, a1: number, b1: number, width: number, fMax: number, minSpan = 10): FreqView {
  const w = Math.max(1, width)
  const d0 = Math.max(8, Math.abs(b0 - a0)), d1 = Math.max(8, Math.abs(b1 - a1))
  const m0 = (a0 + b0) / 2, m1 = (a1 + b1) / 2
  const anchor = xToFreq(m0, start, w)
  const span = (start.hi - start.lo) * (d0 / d1)
  const lo = anchor - (m1 / w) * span
  return clampView({ lo, hi: lo + span }, fMax, minSpan)
}

/** One-axis pan by dx CSS px (content follows the finger). */
export function panView(start: FreqView, dx: number, width: number, fMax: number): FreqView {
  const df = (dx / Math.max(1, width)) * (start.hi - start.lo)
  return clampView({ lo: start.lo - df, hi: start.hi - df }, fMax)
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
