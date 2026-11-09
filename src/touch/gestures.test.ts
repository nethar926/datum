import { describe, expect, it } from 'vitest'
import {
  capDpr, classifyLayout, classifyTwoFinger, exceedsSlop, fingerExactCursor,
  isThreeFingerSwipeDown, panFreqByCentroid, panScrollDeltaS, panView, pinchView,
  PINCH_DIST_THRESH_PX, THREE_FINGER_SWIPE_PX,
} from './gestures'

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
  it('fingers together zooms out (bandwidth wider)', () => {
    const r = pinchView({ lo: 200, hi: 400 }, 300, 700, 400, 600, 1000, 1000)
    expect(r.hi - r.lo).toBeGreaterThan(200)
  })
})

describe('panView / panFreqByCentroid', () => {
  it('content follows the finger and clamps', () => {
    expect(panView({ lo: 100, hi: 200 }, 500, 1000, 1000)).toEqual({ lo: 50, hi: 150 })
    expect(panView({ lo: 100, hi: 200 }, 5000, 1000, 1000)).toEqual({ lo: 0, hi: 100 })
  })
  it('horizontal centroid pan scrolls Hz', () => {
    expect(panFreqByCentroid({ lo: 100, hi: 200 }, 500, 1000, 1000)).toEqual({ lo: 50, hi: 150 })
  })
})

describe('pinch vs pan disambiguation', () => {
  const a0 = { x: 400, y: 300 }, b0 = { x: 600, y: 300 }
  it('distance change without centroid move → pinch', () => {
    expect(classifyTwoFinger(a0, b0, { x: 300, y: 300 }, { x: 700, y: 300 })).toBe('pinch')
  })
  it('centroid move without scale change → pan', () => {
    expect(classifyTwoFinger(a0, b0, { x: 450, y: 300 }, { x: 650, y: 300 })).toBe('pan')
  })
  it('tiny motion stays undecided', () => {
    expect(classifyTwoFinger(a0, b0, { x: 402, y: 301 }, { x: 601, y: 299 })).toBe('undecided')
  })
  it('vertical centroid move (time pan) classifies as pan', () => {
    expect(classifyTwoFinger(a0, b0, { x: 400, y: 340 }, { x: 600, y: 340 })).toBe('pan')
  })
  it('uses thresholds', () => {
    expect(PINCH_DIST_THRESH_PX).toBeGreaterThan(0)
    // Pure scale just above threshold
    const half = PINCH_DIST_THRESH_PX / 2 + 1
    expect(classifyTwoFinger(a0, b0, { x: 400 - half, y: 300 }, { x: 600 + half, y: 300 })).toBe('pinch')
  })
})

describe('finger-exact cursor', () => {
  it('returns the contact point with no offset', () => {
    expect(fingerExactCursor(123.5, 456.25)).toEqual({ x: 123.5, y: 456.25 })
    expect(fingerExactCursor(0, 0)).toEqual({ x: 0, y: 0 })
  })
})

describe('three-finger swipe down', () => {
  it('fires when centroid drops ≥ threshold', () => {
    expect(isThreeFingerSwipeDown([100, 110, 105], [100 + THREE_FINGER_SWIPE_PX, 110 + THREE_FINGER_SWIPE_PX, 105 + THREE_FINGER_SWIPE_PX])).toBe(true)
  })
  it('ignores small or upward moves', () => {
    expect(isThreeFingerSwipeDown([100, 110, 105], [110, 120, 115])).toBe(false)
    expect(isThreeFingerSwipeDown([100, 110, 105], [40, 50, 45])).toBe(false)
  })
  it('needs three contacts', () => {
    expect(isThreeFingerSwipeDown([100, 110], [200, 210])).toBe(false)
  })
})

describe('panScrollDeltaS', () => {
  it('maps vertical centroid move into time delta', () => {
    expect(panScrollDeltaS(100, 200, 300, 1)).toBeCloseTo(150)
    expect(panScrollDeltaS(100, 200, 300, -1)).toBeCloseTo(-150)
  })
})

describe('classifyLayout', () => {
  it('maps the target devices', () => {
    expect(classifyLayout(1194, 834)).toBe('wide')
    expect(classifyLayout(834, 1194)).toBe('wide')
    expect(classifyLayout(393, 852)).toBe('phonePortrait')
    expect(classifyLayout(852, 393)).toBe('phoneLandscape')
    expect(classifyLayout(1440, 860)).toBe('wide')
  })
})

describe('touch helpers', () => {
  it('slop and DPR cap', () => {
    expect(exceedsSlop(0, 0, 6, 6)).toBe(false); expect(exceedsSlop(0, 0, 9, 9)).toBe(true)
    expect(capDpr(3)).toBe(2); expect(capDpr(undefined)).toBe(1); expect(capDpr(1.5)).toBe(1.5)
  })
})
