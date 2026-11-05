import { describe, expect, it } from 'vitest'
import { capDpr, classifyLayout, exceedsSlop, panView, pinchView } from './gestures'

describe('pinchView', () => {
  const v = { lo: 0, hi: 1000 }
  it('spreading fingers zooms in about the midpoint', () => {
    const r = pinchView(v, 400, 600, 300, 700, 1000, 1000)
    expect(r.hi - r.lo).toBeCloseTo(500, 6)
    expect((r.lo + r.hi) / 2).toBeCloseTo(500, 6)
  })
  it('keeps the frequency under the fingers while panning', () => {
    const r = pinchView({ lo: 200, hi: 400 }, 100, 300, 200, 400, 1000, 1000)
    // anchor 240 Hz at x=200 must land at x=300
    expect(r.lo + (300 / 1000) * (r.hi - r.lo)).toBeCloseTo(240, 6)
  })
  it('clamps to the band and the minimum span', () => {
    expect(pinchView(v, 0, 1000, 400, 600, 1000, 1000)).toEqual({ lo: 0, hi: 1000 })
    const z = pinchView(v, 498, 502, 0, 1000, 1000, 1000)
    expect(z.hi - z.lo).toBeGreaterThanOrEqual(10)
  })
})
describe('panView', () => {
  it('content follows the finger and clamps', () => {
    expect(panView({ lo: 100, hi: 200 }, 500, 1000, 1000)).toEqual({ lo: 50, hi: 150 })
    expect(panView({ lo: 100, hi: 200 }, 5000, 1000, 1000)).toEqual({ lo: 0, hi: 100 })
  })
})
describe('classifyLayout', () => {
  it('maps the target devices', () => {
    expect(classifyLayout(1194, 834)).toBe('wide')          // iPad Pro 11 landscape
    expect(classifyLayout(834, 1194)).toBe('wide')          // iPad Pro 11 portrait
    expect(classifyLayout(393, 852)).toBe('phonePortrait')  // iPhone 15 portrait
    expect(classifyLayout(852, 393)).toBe('phoneLandscape') // iPhone 15 landscape
    expect(classifyLayout(1440, 860)).toBe('wide')
  })
})
describe('touch helpers', () => {
  it('slop and DPR cap', () => {
    expect(exceedsSlop(0, 0, 6, 6)).toBe(false); expect(exceedsSlop(0, 0, 9, 9)).toBe(true)
    expect(capDpr(3)).toBe(2); expect(capDpr(undefined)).toBe(1); expect(capDpr(1.5)).toBe(1.5)
  })
})
