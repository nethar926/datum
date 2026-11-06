import { describe, expect, it } from 'vitest'
import {
  DETENT_PROGRESS, DETENT_SPRING_MS, computeSegmentSplit, detentProgress, hasFoldGap, nextDetent,
  prevDetent, progressFromDrag, segmentCssVars, segmentsFitViewport, snapDetent,
} from './layoutMath'

describe('snapDetent', () => {
  it('snaps to gram / half / plot by midpoint bands', () => {
    expect(snapDetent(0)).toBe('gram')
    expect(snapDetent(0.24)).toBe('gram')
    expect(snapDetent(0.25)).toBe('half')
    expect(snapDetent(0.5)).toBe('half')
    expect(snapDetent(0.74)).toBe('half')
    expect(snapDetent(0.75)).toBe('plot')
    expect(snapDetent(1)).toBe('plot')
  })
  it('clamps junk progress', () => {
    expect(snapDetent(-1)).toBe('gram')
    expect(snapDetent(2)).toBe('plot')
    expect(snapDetent(Number.NaN)).toBe('gram')
  })
  it('honours an upward flick toward plot', () => {
    expect(snapDetent(0.1, 0.01)).toBe('half')
    expect(snapDetent(0.4, 0.01)).toBe('plot')
    expect(snapDetent(0.9, 0.01)).toBe('plot')
  })
  it('honours a downward flick toward gram', () => {
    expect(snapDetent(0.9, -0.01)).toBe('half')
    expect(snapDetent(0.4, -0.01)).toBe('gram')
    expect(snapDetent(0.1, -0.01)).toBe('gram')
  })
})

describe('detent helpers', () => {
  it('exposes progress and spring duration', () => {
    expect(detentProgress('gram')).toBe(0)
    expect(detentProgress('half')).toBe(0.5)
    expect(detentProgress('plot')).toBe(1)
    expect(DETENT_PROGRESS.half).toBe(0.5)
    expect(DETENT_SPRING_MS).toBe(180)
  })
  it('cycles next / prev', () => {
    expect(nextDetent('gram')).toBe('half')
    expect(nextDetent('half')).toBe('plot')
    expect(nextDetent('plot')).toBe('gram')
    expect(prevDetent('plot')).toBe('half')
    expect(prevDetent('gram')).toBe('plot')
  })
  it('maps drag dy into progress (finger down closes)', () => {
    expect(progressFromDrag(0.5, 100, 400)).toBeCloseTo(0.25, 12)
    expect(progressFromDrag(0.5, -100, 400)).toBeCloseTo(0.75, 12)
    expect(progressFromDrag(0, -500, 400)).toBe(1)
    expect(progressFromDrag(1, 9999, 400)).toBe(0)
  })
})

describe('computeSegmentSplit', () => {
  it('falls back when segments are missing or alone', () => {
    expect(computeSegmentSplit(null)).toEqual({ mode: 'normal' })
    expect(computeSegmentSplit(undefined)).toEqual({ mode: 'normal' })
    expect(computeSegmentSplit([])).toEqual({ mode: 'normal' })
    expect(computeSegmentSplit([{ x: 0, y: 0, width: 540, height: 720 }])).toEqual({ mode: 'normal' })
  })
  it('splits a Duo-style horizontal hinge with a fold gap', () => {
    // 2×540 with a 40 px hinge between them (Surface Duo-ish).
    const a = { x: 0, y: 0, width: 540, height: 720 }
    const b = { x: 580, y: 0, width: 540, height: 720 }
    const s = computeSegmentSplit([a, b], { width: 1120, height: 720 })
    expect(s.mode).toBe('hinge')
    if (s.mode !== 'hinge') return
    expect(s.axis).toBe('x')
    expect(s.a).toEqual(a)
    expect(s.b).toEqual(b)
    expect(s.fold).toEqual({ x: 540, y: 0, width: 40, height: 720 })
    expect(hasFoldGap(s)).toBe(true)
    const vars = segmentCssVars(s)!
    expect(vars['--seg-fold-w']).toBe('40px')
    expect(vars['--seg-a-w']).toBe('540px')
    expect(vars['--seg-axis']).toBe('x')
  })
  it('splits a vertical hinge', () => {
    const a = { x: 0, y: 0, width: 800, height: 400 }
    const b = { x: 0, y: 420, width: 800, height: 400 }
    const s = computeSegmentSplit([b, a], { width: 800, height: 820 }) // unsorted input
    expect(s.mode).toBe('hinge')
    if (s.mode !== 'hinge') return
    expect(s.axis).toBe('y')
    expect(s.fold).toEqual({ x: 0, y: 400, width: 800, height: 20 })
    expect(hasFoldGap(s)).toBe(true)
  })
  it('treats abutting segments as a zero-width fold', () => {
    const s = computeSegmentSplit([
      { x: 0, y: 0, width: 540, height: 720 },
      { x: 540, y: 0, width: 540, height: 720 },
    ], { width: 1080, height: 720 })
    expect(s.mode).toBe('hinge')
    if (s.mode !== 'hinge') return
    expect(s.fold.width).toBe(0)
    expect(hasFoldGap(s)).toBe(false)
  })
  it('ignores diagonally offset segments', () => {
    expect(computeSegmentSplit([
      { x: 0, y: 0, width: 200, height: 200 },
      { x: 300, y: 300, width: 200, height: 200 },
    ])).toEqual({ mode: 'normal' })
  })
})

describe('segmentsFitViewport / clamp', () => {
  const a = { x: 0, y: 0, width: 540, height: 720 }
  const b = { x: 580, y: 0, width: 540, height: 720 } // span 1120

  it('accepts a hinge that exactly fills the viewport', () => {
    expect(segmentsFitViewport(a, b, 'x', { width: 1120, height: 720 })).toBe(true)
    expect(computeSegmentSplit([a, b], { width: 1120, height: 720 }).mode).toBe('hinge')
  })

  it('falls back when the segment span exceeds innerWidth (e.g. 1120 stub in a 1024 window)', () => {
    expect(segmentsFitViewport(a, b, 'x', { width: 1024, height: 720 })).toBe(false)
    expect(computeSegmentSplit([a, b], { width: 1024, height: 720 })).toEqual({ mode: 'normal' })
  })

  it('falls back when a segment hangs past the right edge', () => {
    const wide = { x: 600, y: 0, width: 600, height: 720 } // right = 1200 > 1120
    expect(computeSegmentSplit([a, wide], { width: 1120, height: 720 })).toEqual({ mode: 'normal' })
  })

  it('falls back on overlapping or negative-size segments', () => {
    expect(computeSegmentSplit([
      { x: 0, y: 0, width: 600, height: 720 },
      { x: 500, y: 0, width: 540, height: 720 },
    ], { width: 1120, height: 720 })).toEqual({ mode: 'normal' })
    expect(computeSegmentSplit([
      { x: 0, y: 0, width: 0, height: 720 },
      { x: 40, y: 0, width: 540, height: 720 },
    ], { width: 1120, height: 720 })).toEqual({ mode: 'normal' })
    expect(computeSegmentSplit([
      { x: 0, y: 0, width: NaN, height: 720 },
      b,
    ], { width: 1120, height: 720 })).toEqual({ mode: 'normal' })
  })

  it('falls back when a vertical hinge exceeds innerHeight', () => {
    const top = { x: 0, y: 0, width: 800, height: 400 }
    const bot = { x: 0, y: 420, width: 800, height: 400 } // span 820
    expect(computeSegmentSplit([top, bot], { width: 800, height: 700 })).toEqual({ mode: 'normal' })
    expect(computeSegmentSplit([top, bot], { width: 800, height: 820 }).mode).toBe('hinge')
  })

  it('still hinges when no viewport is passed (compat)', () => {
    expect(computeSegmentSplit([a, b]).mode).toBe('hinge')
  })
})
