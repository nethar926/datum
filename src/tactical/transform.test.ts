import { describe, expect, it } from 'vitest'
import {
  PLOT_CAMERA_FITTED, PLOT_FIT_SPAN_M, PLOT_SPAN_MAX_M, PLOT_SPAN_MIN_M, PLOT_WHEEL_FACTOR,
  clampPlotSpan, fitView, panPlotCamera, recentrePlotCamera, toScreenX, toScreenY, toWorld, zoomPlotCamera,
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
