import { describe, expect, it } from 'vitest'
import {
  PLOT_CAMERA_FITTED, PLOT_FIELD_MARGIN, PLOT_FIT_SPAN_M, PLOT_OVERLAY_BOTTOM_BAR, PLOT_OVERLAY_LEADING,
  PLOT_OVERLAY_TRAILING, PLOT_SPAN_MAX_M, PLOT_SPAN_MIN_M, PLOT_WHEEL_FACTOR,
  clampPlotSpan, fitView, panPlotCamera, plotInsets, recentrePlotCamera, toScreenX, toScreenY, toWorld,
  usablePlotRect, zoomPlotCamera,
} from './transform'

describe('plot camera (shared with native PlotCamera)', () => {
  it('shared constants and recentre fit', () => {
    expect(PLOT_FIT_SPAN_M).toBe(18000)
    expect(PLOT_SPAN_MIN_M).toBe(4500)
    expect(PLOT_SPAN_MAX_M).toBe(72000)
    expect(PLOT_WHEEL_FACTOR).toBeCloseTo(1.1, 12)
    expect(PLOT_CAMERA_FITTED).toEqual({ spanM: 18000, cx: 0, cy: 0 })
    expect(clampPlotSpan(18000)).toBe(18000)
    expect(clampPlotSpan(100)).toBe(4500)
    expect(clampPlotSpan(1e9)).toBe(72000)
    expect(recentrePlotCamera()).toEqual(PLOT_CAMERA_FITTED)
  })

  it('zoom keeps the world point under the same screen pixel', () => {
    let cam = { ...PLOT_CAMERA_FITTED }
    const w = 800, h = 600
    const v0 = fitView(w, h, cam.spanM, cam.cx, cam.cy)
    const wx = 3000, wy = 1000
    const sx = toScreenX(v0, wx), sy = toScreenY(v0, wy)
    cam = zoomPlotCamera(cam, 0.5, wx, wy)
    expect(cam.spanM).toBeCloseTo(9000, 9)
    const v1 = fitView(w, h, cam.spanM, cam.cx, cam.cy)
    expect(toScreenX(v1, wx)).toBeCloseTo(sx, 9)
    expect(toScreenY(v1, wy)).toBeCloseTo(sy, 9)
    cam = zoomPlotCamera(cam, 100, wx, wy)
    expect(cam.spanM).toBe(72000)
    const v2 = fitView(w, h, cam.spanM, cam.cx, cam.cy)
    expect(toScreenX(v2, wx)).toBeCloseTo(sx, 9)
    expect(toScreenY(v2, wy)).toBeCloseTo(sy, 9)
  })

  it('pan and world round-trip', () => {
    const cam = panPlotCamera(PLOT_CAMERA_FITTED, 500, -200)
    expect(cam).toEqual({ spanM: 18000, cx: 500, cy: -200 })
    expect(recentrePlotCamera()).toEqual(PLOT_CAMERA_FITTED)
    const c = { spanM: 9000, cx: 400, cy: -250 }
    const v = fitView(400, 300, c.spanM, c.cx, c.cy)
    const w = toWorld(v, 120, 80)
    expect(toScreenX(v, w.x)).toBeCloseTo(120, 9)
    expect(toScreenY(v, w.y)).toBeCloseTo(80, 9)
  })
})

describe('plot viewport insets (shared with native PlotViewport)', () => {
  it('fits the 18 km field inside a trailing toolbar inset', () => {
    const w = 400, h = 600
    const insets = plotInsets({ safeTrailing: 80, dropBar: true })
    expect(insets.trailing).toBe(80 + PLOT_OVERLAY_TRAILING + PLOT_FIELD_MARGIN)
    expect(insets.leading).toBe(PLOT_OVERLAY_LEADING + PLOT_FIELD_MARGIN)
    expect(insets.bottom).toBe(PLOT_OVERLAY_BOTTOM_BAR + PLOT_FIELD_MARGIN)
    const v = fitView(w, h, 18000, 0, 0, insets)
    const u = usablePlotRect(w, h, insets)
    expect(v.ux).toBe(u.x)
    expect(v.uw).toBe(u.w)
    const ox = toScreenX(v, 0)
    expect(ox).toBeCloseTo(u.x + u.w / 2, 9)
    expect(ox).toBeLessThan(w / 2)
    const half = 18000 / 2
    const clear = usablePlotRect(w, h, {
      top: insets.top - PLOT_FIELD_MARGIN,
      leading: insets.leading - PLOT_FIELD_MARGIN,
      bottom: insets.bottom - PLOT_FIELD_MARGIN,
      trailing: insets.trailing - PLOT_FIELD_MARGIN,
    })
    for (const [x, y] of [[0, 0], [half, 0], [-half, 0], [0, half], [0, -half], [half, half], [half, -half], [-half, half], [-half, -half]] as const) {
      const sx = toScreenX(v, x), sy = toScreenY(v, y)
      expect(sx).toBeGreaterThanOrEqual(u.x)
      expect(sx).toBeLessThanOrEqual(u.x + u.w)
      expect(sy).toBeGreaterThanOrEqual(u.y)
      expect(sy).toBeLessThanOrEqual(u.y + u.h)
      expect(sx - 8).toBeGreaterThanOrEqual(clear.x)
      expect(sx + 8).toBeLessThanOrEqual(clear.x + clear.w)
    }
    const raw = fitView(w, h, 18000, 0, 0)
    expect(toScreenX(raw, half)).toBeGreaterThan(w - 80)
  })

  it('round-trips world coordinates through an inset view', () => {
    const insets = plotInsets({ safeTrailing: 80, dropBar: true })
    const v = fitView(400, 300, 9000, 400, -250, insets)
    const w = toWorld(v, 160, 90)
    expect(toScreenX(v, w.x)).toBeCloseTo(160, 9)
    expect(toScreenY(v, w.y)).toBeCloseTo(90, 9)
  })
})
