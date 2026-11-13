/** World (m, x east, y north) ⇄ screen (px, y down) for the tactical plot. */
export interface PlotInsets { top: number; leading: number; bottom: number; trailing: number }
export const PLOT_INSETS_ZERO: PlotInsets = { top: 0, leading: 0, bottom: 0, trailing: 0 }

/** Overlay chrome and field margin, shared with native `PlotViewport`. Units are canvas px. */
export const PLOT_OVERLAY_LEADING = 60
export const PLOT_OVERLAY_TOP = 8
export const PLOT_OVERLAY_TRAILING = 8
export const PLOT_OVERLAY_BOTTOM_BAR = 68
export const PLOT_FIELD_MARGIN = 20

export function plotInsets(opts: {
  safeTop?: number; safeLeading?: number; safeBottom?: number; safeTrailing?: number
  dropBar: boolean; margin?: number
}): PlotInsets {
  const margin = opts.margin ?? PLOT_FIELD_MARGIN
  return {
    top: (opts.safeTop ?? 0) + PLOT_OVERLAY_TOP + margin,
    leading: (opts.safeLeading ?? 0) + PLOT_OVERLAY_LEADING + margin,
    bottom: (opts.safeBottom ?? 0) + (opts.dropBar ? PLOT_OVERLAY_BOTTOM_BAR : 0) + margin,
    trailing: (opts.safeTrailing ?? 0) + PLOT_OVERLAY_TRAILING + margin,
  }
}

export function scaleInsets(insets: PlotInsets, k: number): PlotInsets {
  return { top: insets.top * k, leading: insets.leading * k, bottom: insets.bottom * k, trailing: insets.trailing * k }
}

export function usablePlotRect(width: number, height: number, insets: PlotInsets = PLOT_INSETS_ZERO): { x: number; y: number; w: number; h: number } {
  const x = Math.max(0, insets.leading)
  const y = Math.max(0, insets.top)
  const w = Math.max(1, width - insets.leading - insets.trailing)
  const h = Math.max(1, height - insets.top - insets.bottom)
  return { x, y, w, h }
}

export interface PlotView {
  cx: number; cy: number; mPerPx: number; w: number; h: number
  ux: number; uy: number; uw: number; uh: number
}
export const fitView = (w: number, h: number, spanM: number, cx = 0, cy = 0, insets: PlotInsets = PLOT_INSETS_ZERO): PlotView => {
  const u = usablePlotRect(w, h, insets)
  return { cx, cy, w, h, ux: u.x, uy: u.y, uw: u.w, uh: u.h, mPerPx: spanM / Math.max(1, Math.min(u.w, u.h)) }
}
export const toScreenX = (v: PlotView, x: number): number => v.ux + v.uw / 2 + (x - v.cx) / v.mPerPx
export const toScreenY = (v: PlotView, y: number): number => v.uy + v.uh / 2 - (y - v.cy) / v.mPerPx
export const toWorld = (v: PlotView, sx: number, sy: number): { x: number; y: number } => (
  { x: v.cx + (sx - (v.ux + v.uw / 2)) * v.mPerPx, y: v.cy - (sy - (v.uy + v.uh / 2)) * v.mPerPx }
)

/** Shared with native `PlotCamera` (DatumAppCore). Recentre is this 18 km fit at the origin. */
export const PLOT_FIT_SPAN_M = 18000
/** 4× zoom in from the fit. */
export const PLOT_SPAN_MIN_M = 4500
/** 4× zoom out from the fit. */
export const PLOT_SPAN_MAX_M = 72000
/** Wheel zoom step: each notch multiplies or divides span by this. */
export const PLOT_WHEEL_FACTOR = 1.1

export const clampPlotSpan = (span: number): number => Math.min(PLOT_SPAN_MAX_M, Math.max(PLOT_SPAN_MIN_M, span))

export interface PlotCamera { spanM: number; cx: number; cy: number }
export const PLOT_CAMERA_FITTED: PlotCamera = { spanM: PLOT_FIT_SPAN_M, cx: 0, cy: 0 }

/** Zoom so span becomes `spanM * factor` (factor > 1 zooms out), keeping world (`wx`,`wy`) under the same pixel. */
export function zoomPlotCamera(cam: PlotCamera, factor: number, wx: number, wy: number): PlotCamera {
  const newSpan = clampPlotSpan(cam.spanM * factor)
  if (!(cam.spanM > 0) || newSpan === cam.spanM) return { spanM: newSpan, cx: cam.cx, cy: cam.cy }
  const k = newSpan / cam.spanM
  return { spanM: newSpan, cx: wx + (cam.cx - wx) * k, cy: wy + (cam.cy - wy) * k }
}

export function panPlotCamera(cam: PlotCamera, dx: number, dy: number): PlotCamera {
  return { spanM: cam.spanM, cx: cam.cx + dx, cy: cam.cy + dy }
}

export function recentrePlotCamera(): PlotCamera { return { ...PLOT_CAMERA_FITTED } }
