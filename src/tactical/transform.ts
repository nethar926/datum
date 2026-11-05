/** World (m, x east, y north) ⇄ screen (px, y down) for the tactical plot. */
export interface PlotView { cx: number; cy: number; mPerPx: number; w: number; h: number }
export const fitView = (w: number, h: number, spanM: number, cx = 0, cy = 0): PlotView => ({ cx, cy, w, h, mPerPx: spanM / Math.max(1, Math.min(w, h)) })
export const toScreenX = (v: PlotView, x: number): number => v.w / 2 + (x - v.cx) / v.mPerPx
export const toScreenY = (v: PlotView, y: number): number => v.h / 2 - (y - v.cy) / v.mPerPx
export const toWorld = (v: PlotView, sx: number, sy: number): { x: number; y: number } => ({ x: v.cx + (sx - v.w / 2) * v.mPerPx, y: v.cy - (sy - v.h / 2) * v.mPerPx })
