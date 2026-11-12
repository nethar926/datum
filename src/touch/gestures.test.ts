import { describe, expect, it } from 'vitest'
import {
  applyTwoFingerPan, capDpr, classifyLayout, classifyTwoFinger, exceedsSlop, fingerExactCursor,
  isThreeFingerSwipeDown, lockPanAxis, panFreqByCentroid, panScrollDeltaS, panView, pinchView,
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

describe('lockPanAxis', () => {
  it('locks to frequency when horizontal dominates, time when vertical does', () => {
    expect(lockPanAxis(30, 8)).toBe('frequency')
    expect(lockPanAxis(8, 30)).toBe('time')
    expect(lockPanAxis(-25, 10)).toBe('frequency')
    expect(lockPanAxis(-4, -12)).toBe('time')
  })
  it('stays unlocked on a perfect diagonal until one side wins', () => {
    expect(lockPanAxis(20, 20)).toBe(null)
    expect(lockPanAxis(0, 0)).toBe(null)
  })
  it('holds the first decisive axis: a later orthogonal move does not relock', () => {
    // Caller only invokes lockPanAxis while the axis is still null (Gram.tsx / native machine).
    let axis = lockPanAxis(40, 0)
    expect(axis).toBe('frequency')
    if (axis === null) axis = lockPanAxis(40, 100) // not reached: already locked
    expect(axis).toBe('frequency')
    axis = axis ?? lockPanAxis(0, 80)
    expect(axis).toBe('frequency')
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

describe('applyTwoFingerPan (frequency swipe, pause-only history, axis lock)', () => {
  const startView = { lo: 100, hi: 200 }
  const base = {
    startView, width: 1000, fMax: 1000, minSpan: 10, fMin: 0,
    scroll0: 0, height: 200, visibleHistoryS: 300, sign: 1 as const,
  }
  const hz = (dx: number, paused: boolean, axis: ReturnType<typeof lockPanAxis> = null) =>
    applyTwoFingerPan({ ...base, axis, dx, dy: 0, paused })

  it('horizontal swipe pans frequency while playing and while paused', () => {
    const playing = hz(500, false)
    const paused = hz(500, true)
    expect(playing.axis).toBe('frequency')
    expect(paused.axis).toBe('frequency')
    expect(playing.view).toEqual({ lo: 50, hi: 150 })
    expect(paused.view).toEqual({ lo: 50, hi: 150 })
    expect(playing.scrollBackS).toBe(0)
    expect(paused.scrollBackS).toBe(0)
  })

  it('vertical drag only scrolls history when paused', () => {
    const playing = applyTwoFingerPan({ ...base, axis: null, dx: 0, dy: 100, paused: false })
    expect(playing.axis).toBe('time')
    expect(playing.view).toEqual(startView)
    expect(playing.scrollBackS).toBe(0)

    const paused = applyTwoFingerPan({ ...base, axis: null, dx: 0, dy: 100, paused: true })
    expect(paused.axis).toBe('time')
    expect(paused.view).toEqual(startView)
    expect(paused.scrollBackS).toBeCloseTo(panScrollDeltaS(100, 200, 300, 1))
    expect(paused.scrollBackS).toBeGreaterThan(0)
  })

  it('axis lock holds through a diagonal: first decisive axis wins until lift', () => {
    // Perfect diagonal stays unlocked; nothing moves.
    const diag = applyTwoFingerPan({ ...base, axis: null, dx: 40, dy: 40, paused: true })
    expect(diag.axis).toBeNull()
    expect(diag.view).toEqual(startView)
    expect(diag.scrollBackS).toBe(0)

    // Horizontal wins, then a later diagonal must not unlock into a history scroll.
    const locked = applyTwoFingerPan({ ...base, axis: null, dx: 50, dy: 10, paused: true })
    expect(locked.axis).toBe('frequency')
    const through = applyTwoFingerPan({
      ...base, axis: locked.axis, dx: 80, dy: 80, paused: true, startView: locked.view,
    })
    expect(through.axis).toBe('frequency')
    expect(through.scrollBackS).toBe(0)
    expect(through.view.lo).not.toBe(startView.lo)
    expect(through.view).toEqual(panFreqByCentroid(locked.view, 80, 1000, 1000))

    // Time lock, then a diagonal, does not pan Hz.
    const time = applyTwoFingerPan({ ...base, axis: null, dx: 10, dy: 50, paused: true })
    expect(time.axis).toBe('time')
    const timeDiag = applyTwoFingerPan({
      ...base, axis: time.axis, dx: 80, dy: 80, paused: true, scroll0: time.scrollBackS,
    })
    expect(timeDiag.axis).toBe('time')
    expect(timeDiag.view).toEqual(startView)
    expect(timeDiag.scrollBackS).toBeGreaterThan(0)
  })
})
