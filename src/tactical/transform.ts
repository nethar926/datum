/** World (m, x east, y north) ⇄ screen (px, y down) for the tactical plot. */
export interface PlotView { cx: number; cy: number; mPerPx: number; w: number; h: number }
export const fitView = (w: number, h: number, spanM: number, cx = 0, cy = 0): PlotView => ({ cx, cy, w, h, mPerPx: spanM / Math.max(1, Math.min(w, h)) })
export const toScreenX = (v: PlotView, x: number): number => v.w / 2 + (x - v.cx) / v.mPerPx
export const toScreenY = (v: PlotView, y: number): number => v.h / 2 - (y - v.cy) / v.mPerPx
export const toWorld = (v: PlotView, sx: number, sy: number): { x: number; y: number } => ({ x: v.cx + (sx - v.w / 2) * v.mPerPx, y: v.cy - (sy - v.h / 2) * v.mPerPx })

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
