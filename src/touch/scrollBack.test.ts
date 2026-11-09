import { describe, expect, it } from 'vitest'
import {
  MAX_SCROLL_BACK_S, applyScrollDelta, clampScrollBackS, formatZuluHms,
  isReviewing, returnToLive, viewNowS,
} from './scrollBack'

describe('15-min scroll-back clamp', () => {
  it('caps at 15 minutes even when more history exists', () => {
    expect(MAX_SCROLL_BACK_S).toBe(900)
    expect(clampScrollBackS(1200, 2000)).toBe(900)
  })
  it('never exceeds available history', () => {
    expect(clampScrollBackS(600, 300)).toBe(300)
    expect(clampScrollBackS(-10, 300)).toBe(0)
  })
  it('applyScrollDelta accumulates and clamps', () => {
    expect(applyScrollDelta(100, 50, 400)).toBe(150)
    expect(applyScrollDelta(880, 50, 2000)).toBe(900)
  })
  it('Return to Live clears scroll-back', () => {
    expect(returnToLive()).toBe(0)
    expect(isReviewing(0)).toBe(false)
    expect(isReviewing(12)).toBe(true)
  })
  it('viewNowS shifts the live edge', () => {
    expect(viewNowS(1000, 120)).toBe(880)
  })
})

describe('Zulu HH:MM:SSz', () => {
  it('formats 24-hour clock with lowercase z', () => {
    const origin = Date.UTC(2026, 0, 1, 2, 13, 0)
    expect(formatZuluHms(47, origin)).toBe('02:13:47z')
    expect(formatZuluHms(0, origin)).toBe('02:13:00z')
    expect(formatZuluHms(-1, origin)).toBe('02:12:59z')
  })
  it('wraps past midnight in 24-hour form', () => {
    const origin = Date.UTC(2026, 0, 1, 23, 59, 50)
    expect(formatZuluHms(15, origin)).toBe('00:00:05z')
  })
})
