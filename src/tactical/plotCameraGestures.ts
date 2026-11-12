/**
 * Shared with native `PlotDoubleTap` / plot-camera ownership.
 * Pinch, pan, wheel and empty-plot drag only run when the drop run and the
 * armed BRG tool are idle, and a one-finger hit on a buoy stays a bearing /
 * buoy-select (not a pan).
 */
export const PLOT_DOUBLE_TAP_S = 0.3
export const PLOT_DOUBLE_TAP_SLOP_PT = 24

export interface PlotDoubleTapState { t: number; x: number; y: number }

export function plotDoubleTap(
  last: PlotDoubleTapState | null,
  x: number,
  y: number,
  nowS: number,
): { kind: 'pick' | 'recentre'; last: PlotDoubleTapState | null } {
  if (last && nowS - last.t <= PLOT_DOUBLE_TAP_S && Math.hypot(x - last.x, y - last.y) <= PLOT_DOUBLE_TAP_SLOP_PT) {
    return { kind: 'recentre', last: null }
  }
  return { kind: 'pick', last: { t: nowS, x, y } }
}

/** False when the drop run or armed BRG owns the plot — camera gestures stand down. */
export function plotCameraAllows(opts: { dropCaptures: boolean; brgArmed: boolean }): boolean {
  return !opts.dropCaptures && !opts.brgArmed
}
