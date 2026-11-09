/**
 * Paused review scroll-back: two-finger vertical pan looks up to MAX_SCROLL_BACK_S of history
 * while collection continues. Live mode uses scrollBackS = 0 (Return to Live).
 */

/** Hard ceiling: 15 minutes of scroll-back (Wilson). */
export const MAX_SCROLL_BACK_S = 15 * 60

/** Clamp a proposed scroll-back (seconds before live edge) into [0, min(maxS, availableS)]. */
export function clampScrollBackS(proposedS: number, availableHistoryS: number, maxS = MAX_SCROLL_BACK_S): number {
  const cap = Math.max(0, Math.min(maxS, availableHistoryS))
  if (!Number.isFinite(proposedS) || proposedS <= 0) return 0
  return Math.min(cap, proposedS)
}

/** Apply a pan delta (seconds, + = further back) onto the current scroll-back. */
export function applyScrollDelta(currentS: number, deltaS: number, availableHistoryS: number, maxS = MAX_SCROLL_BACK_S): number {
  return clampScrollBackS(currentS + deltaS, availableHistoryS, maxS)
}

/** Return-to-live clears scroll-back. */
export const returnToLive = (): number => 0

/** True when the operator is reviewing history (not on the live edge). */
export const isReviewing = (scrollBackS: number): boolean => scrollBackS > 1e-6

/**
 * Zulu clock with seconds: `HH:MM:SSz` (24-hour, lowercase z).
 * originMs = wall-clock UTC ms at sim t = 0.
 */
export function formatZuluHms(simS: number, originMs: number): string {
  const d = new Date(originMs + simS * 1000)
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  const ss = String(d.getUTCSeconds()).padStart(2, '0')
  return `${hh}:${mm}:${ss}z`
}

/** Sim time (seconds) at the top/bottom of the scrolled view given live nowS and scrollBackS. */
export function viewNowS(liveNowS: number, scrollBackS: number): number {
  return liveNowS - Math.max(0, scrollBackS)
}
