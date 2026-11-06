import { describe, expect, it } from 'vitest'
import {
  agoFromY, yFromAgo, yFromTime, timeFromY, pctFromAgo, dtFromScreenDy,
  newestAtBottom, parseGramDir, formatZulu, formatZuluSec, timeTickAges, flipUniform, DEFAULT_GRAM_DIR,
} from './timeAxis'

describe('timeAxis direction', () => {
  it('defaults to newest at bottom', () => {
    expect(DEFAULT_GRAM_DIR).toBe('bottom')
    expect(newestAtBottom('bottom')).toBe(true)
    expect(newestAtBottom('top')).toBe(false)
    expect(parseGramDir(null)).toBe('bottom')
    expect(parseGramDir('top')).toBe('top')
    expect(parseGramDir('nope')).toBe('bottom')
    expect(flipUniform('bottom')).toBe(1)
    expect(flipUniform('top')).toBe(0)
  })

  it('maps y↔ago both ways (newest at bottom)', () => {
    const H = 400, hist = 200
    expect(agoFromY(0, H, hist, 'bottom')).toBeCloseTo(hist)       // top = oldest
    expect(agoFromY(H, H, hist, 'bottom')).toBeCloseTo(0)          // bottom = now
    expect(agoFromY(H / 2, H, hist, 'bottom')).toBeCloseTo(hist / 2)
    expect(yFromAgo(0, H, hist, 'bottom')).toBeCloseTo(H)          // now → bottom
    expect(yFromAgo(hist, H, hist, 'bottom')).toBeCloseTo(0)       // oldest → top
    expect(pctFromAgo(0, hist, 'bottom')).toBeCloseTo(100)
    expect(pctFromAgo(hist, hist, 'bottom')).toBeCloseTo(0)
  })

  it('maps y↔ago both ways (newest at top / legacy)', () => {
    const H = 400, hist = 200
    expect(agoFromY(0, H, hist, 'top')).toBeCloseTo(0)
    expect(agoFromY(H, H, hist, 'top')).toBeCloseTo(hist)
    expect(yFromAgo(0, H, hist, 'top')).toBeCloseTo(0)
    expect(yFromAgo(hist, H, hist, 'top')).toBeCloseTo(H)
    expect(pctFromAgo(0, hist, 'top')).toBeCloseTo(0)
  })

  it('round-trips time through Y', () => {
    const now = 1000, H = 300, hist = 300
    for (const dir of ['bottom', 'top'] as const) {
      for (const ago of [0, 50, 150, 299]) {
        const y = yFromAgo(ago, H, hist, dir)
        expect(agoFromY(y, H, hist, dir)).toBeCloseTo(ago, 5)
        const t = now - ago
        expect(timeFromY(yFromTime(t, now, H, hist, dir), now, H, hist, dir)).toBeCloseTo(t, 5)
      }
    }
  })

  it('puts the approach leg (older) above f0 when newest is at the bottom', () => {
    const now = 500, H = 400, hist = 400
    const tCpa = 400, t1 = 340 // approach 60 s earlier
    const y0 = yFromTime(tCpa, now, H, hist, 'bottom')
    const y1 = yFromTime(t1, now, H, hist, 'bottom')
    expect(y1).toBeLessThan(y0) // older → above
    // Legacy: older below
    expect(yFromTime(t1, now, H, hist, 'top')).toBeGreaterThan(yFromTime(tCpa, now, H, hist, 'top'))
  })

  it('converts screen Δy to Δt with the correct sign per direction', () => {
    // +40 px down on a 400 px / 200 s gram = 20 s of screen travel
    expect(dtFromScreenDy(40, 400, 200, 'bottom')).toBeCloseTo(20)  // down = later
    expect(dtFromScreenDy(40, 400, 200, 'top')).toBeCloseTo(-20)    // down = older
  })

  it('formats Zulu from an origin + sim seconds', () => {
    // 2024-06-01T12:00:00.000Z + 75 s → 1201Z
    const origin = Date.UTC(2024, 5, 1, 12, 0, 0)
    expect(formatZulu(0, origin)).toBe('1200Z')
    expect(formatZulu(75, origin)).toBe('1201Z')
    expect(formatZulu(3661, origin)).toBe('1301Z')
    expect(formatZulu(-60, origin)).toBe('1159Z') // pre-start tick
  })

  it('thins Y ticks on short canvases (iPhone landscape)', () => {
    expect(timeTickAges(1200, 86).length).toBe(3)
    expect(timeTickAges(1200, 145).length).toBe(4)
    expect(timeTickAges(1200, 500).length).toBe(6)
    expect(timeTickAges(1200, 86)[0]).toBe(0)
    expect(timeTickAges(1200, 86).at(-1)).toBeCloseTo(1200)
  })
})

describe('formatZuluSec', () => {
  it('formats HHmmssZ in UTC', () => {
    const origin = Date.UTC(2026, 10, 5, 2, 13, 0)
    expect(formatZuluSec(47, origin)).toBe('021347Z')
    expect(formatZuluSec(-1, origin)).toBe('021259Z')
  })
})
