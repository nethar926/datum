import { afterEach, describe, expect, it } from 'vitest'
import { crossFixes } from './fix'
import {
  AUTO_BEARING, DEFAULT_FIX_COLOR, DEFAULT_FIX_FADE_S, DEFAULT_FIX_SHAPE, FIX_COLOR_RGB,
  FIX_COLORS, FIX_SHAPES, SHOW_AUTO_FIXES, clampFixFadeS, displayedAutoFixes,
  fixAvoidsCrease, fixLineAlpha, fixMenuFrame, hitFix, loadFixFadeS, resetFixFadeForTests, saveFixFadeS,
} from './fixStyle'
import { FixStore } from './fixStore'

describe('Fix style (bearings and operator fixes)', () => {
  afterEach(() => {
    resetFixFadeForTests()
  })

  it('disables auto fixes in the UI layer only', () => {
    expect(SHOW_AUTO_FIXES).toBe(false)
    const a = { buoyId: 11, freqHz: 72, brgDeg: 45, quality: 20 }
    const b = { buoyId: 12, freqHz: 72.5, brgDeg: 315, quality: 18 }
    const buoys = [
      { id: 11, channel: 11, kind: 'difar' as const, x: -2000, y: 0, hydrophoneDepthM: 90, batteryFrac: 1, lifeRemainingS: 1000, state: 'live' as const },
      { id: 12, channel: 12, kind: 'difar' as const, x: 2000, y: 0, hydrophoneDepthM: 90, batteryFrac: 1, lifeRemainingS: 1000, state: 'live' as const },
    ]
    const computed = crossFixes([a, b], buoys)
    expect(computed.length).toBe(1)
    expect(displayedAutoFixes(computed)).toEqual([])
  })

  it('uses violet auto bearings and yellow multiply as the passive-fix default', () => {
    expect(AUTO_BEARING).toMatch(/157,\s*107,\s*255/)
    expect(DEFAULT_FIX_COLOR).toBe('yellow')
    expect(DEFAULT_FIX_SHAPE).toBe('multiply')
    expect(FIX_COLOR_RGB.yellow).toBe('#ffd60a')
    expect([...FIX_COLORS]).toEqual(['green', 'yellow', 'orange', 'red', 'purple', 'blue'])
    expect([...FIX_SHAPES]).toEqual(['multiply', 'plus', 'staroflife.fill', 'star.fill', 'burst.fill', 'sub'])
  })

  it('fades cyan fix lines over a configurable sim-time window, default 2 minutes', () => {
    expect(DEFAULT_FIX_FADE_S).toBe(120)
    expect(fixLineAlpha(0)).toBe(1)
    expect(fixLineAlpha(60)).toBeCloseTo(0.5)
    expect(fixLineAlpha(120)).toBe(0)
    expect(fixLineAlpha(200)).toBe(0)
    expect(fixLineAlpha(30, 60)).toBeCloseTo(0.5)
    expect(loadFixFadeS()).toBe(120)
    saveFixFadeS(45)
    expect(loadFixFadeS()).toBe(45)
    expect(clampFixFadeS(5)).toBe(10)
  })

  it('keeps the fix menu inside the plot and off the hinge crease', () => {
    const plot = { x: 0, y: 0, width: 400, height: 600 }
    const frame = fixMenuFrame(50, 50, plot)!
    expect(frame.x).toBeGreaterThanOrEqual(plot.x)
    expect(frame.y).toBeGreaterThanOrEqual(plot.y)
    expect(frame.x + frame.width).toBeLessThanOrEqual(plot.x + plot.width)
    expect(frame.y + frame.height).toBeLessThanOrEqual(plot.y + plot.height)
    const crease = { x: 300, y: 0, width: 24, height: 600 }
    const clipped = fixMenuFrame(310, 200, plot, crease)!
    expect(fixAvoidsCrease(clipped, crease)).toBe(true)
    expect(clipped.x + clipped.width).toBeLessThanOrEqual(crease.x)
  })

  it('hits the nearest laid fix inside the target', () => {
    const marks = [{ id: 1, sx: 10, sy: 10 }, { id: 2, sx: 14, sy: 10 }]
    expect(hitFix(marks, 13, 10, 22)).toBe(2)
    expect(hitFix(marks, 200, 200, 22)).toBeNull()
  })

  it('stores cyan rays and default yellow multiply on lay, and delete removes the fix', () => {
    const store = new FixStore()
    const buoys = [
      { id: 1, x: 0, y: 0, kind: 'difar', state: 'live' },
      { id: 2, x: 4000, y: 0, kind: 'difar', state: 'live' },
    ]
    const target = { x: 2000, y: 3000 }
    const brg = (x: number, y: number) => {
      const d = Math.atan2(target.x - x, target.y - y) * 180 / Math.PI
      return (d + 360) % 360
    }
    const r = store.layFix({ 1: brg(0, 0), 2: brg(4000, 0) }, { 1: 10, 2: 10 }, buoys, 10)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.fix.color).toBe('yellow')
    expect(r.fix.shape).toBe('multiply')
    expect(r.fix.rays).toHaveLength(2)
    expect(r.fix.tS).toBe(10)
    store.setFixColor(r.fix.id, 'blue')
    store.setFixShape(r.fix.id, 'sub')
    expect(store.fixes[0]!.color).toBe('blue')
    expect(store.fixes[0]!.shape).toBe('sub')
    store.deleteFix(r.fix.id)
    expect(store.fixes).toHaveLength(0)
    expect(store.flash).toBe('Deleted 1')
  })
})
